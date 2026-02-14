const API_BASE = 'http://localhost:11434';
const STORAGE_KEY = 'ollama-web-state-v1';
const DEFAULT_TITLE = 'Nueva conversación';
const BACKGROUND_STORAGE_KEY = 'ollama-web-background-date';
const DYSLEXIC_FONT_KEY = 'ollama-web-dyslexic-font';
const CANVAS_STORAGE_KEY = 'ollama-web-canvas-v1';
const CANVAS_DEFAULT_TITLE = 'Nuevo documento';
const PDF_DB_NAME = 'ollama-web-pdf-store';
const PDF_DB_VERSION = 1;
const SCORE_CANVAS_STORAGE_KEY = 'ollama-web-score-canvas-v1';
const SCORE_CANVAS_DEFAULT_TITLE = 'Nueva partitura';

// IndexedDB for storing large PDF binaries
let pdfDatabase = null;

async function initPdfDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PDF_DB_NAME, PDF_DB_VERSION);

    request.onerror = () => {
      console.warn('IndexedDB not available for PDF storage');
      resolve(null);
    };

    request.onsuccess = (event) => {
      pdfDatabase = event.target.result;
      console.log('📦 PDF IndexedDB initialized');
      resolve(pdfDatabase);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('pdfFiles')) {
        db.createObjectStore('pdfFiles', { keyPath: 'id' });
      }
    };
  });
}

async function savePdfToIndexedDB(fileId, pdfBinary) {
  if (!pdfDatabase) await initPdfDatabase();
  if (!pdfDatabase) return false;

  return new Promise((resolve) => {
    try {
      const transaction = pdfDatabase.transaction(['pdfFiles'], 'readwrite');
      const store = transaction.objectStore('pdfFiles');
      store.put({ id: fileId, binary: pdfBinary, timestamp: Date.now() });
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => resolve(false);
    } catch (e) {
      console.warn('Error saving PDF to IndexedDB:', e);
      resolve(false);
    }
  });
}

async function getPdfFromIndexedDB(fileId) {
  if (!pdfDatabase) await initPdfDatabase();
  if (!pdfDatabase) return null;

  return new Promise((resolve) => {
    try {
      const transaction = pdfDatabase.transaction(['pdfFiles'], 'readonly');
      const store = transaction.objectStore('pdfFiles');
      const request = store.get(fileId);
      request.onsuccess = () => resolve(request.result?.binary || null);
      request.onerror = () => resolve(null);
    } catch (e) {
      console.warn('Error getting PDF from IndexedDB:', e);
      resolve(null);
    }
  });
}

async function deletePdfFromIndexedDB(fileId) {
  if (!pdfDatabase) await initPdfDatabase();
  if (!pdfDatabase) return;

  try {
    const transaction = pdfDatabase.transaction(['pdfFiles'], 'readwrite');
    const store = transaction.objectStore('pdfFiles');
    store.delete(fileId);
  } catch (e) {
    console.warn('Error deleting PDF from IndexedDB:', e);
  }
}

const chatList = document.getElementById('chat-list');
const chatForm = document.getElementById('chat-form');
const chatFormInline = document.getElementById('chat-form-inline');
const promptInput = document.getElementById('prompt-input');
const promptInputInline = document.getElementById('prompt-input-inline');
const modelSelect = document.getElementById('model-select');
const modelSelectInline = document.getElementById('model-select-inline');
const quickActionButtons = Array.from(document.querySelectorAll('.chip:not(.claude-chip)'));
const conversationList = document.getElementById('conversation-list');
const newConversationButton = document.getElementById('new-conversation');
const renameConversationButton = document.getElementById('rename-conversation');
const deleteConversationButton = document.getElementById('delete-conversation');
const conversationTitle = document.getElementById('conversation-title');
const emptyState = document.getElementById('empty-state');
const chatState = document.getElementById('chat-state');
const sidebar = document.getElementById('sidebar');
const toggleSidebarButton = document.getElementById('toggle-sidebar');
const layout = document.getElementById('app');
const incognitoButton = document.getElementById('incognito-toggle');
const incognitoButtonEmpty = document.getElementById('incognito-toggle-empty');
const canvasPanel = document.getElementById('canvas-panel');
const canvasEditorEl = document.getElementById('canvas-editor');
const canvasTitleInput = document.getElementById('canvas-title-input');
const canvasCloseBtn = document.getElementById('canvas-close-btn');

const state = {
  conversations: {},
  order: [],
  activeId: null,
  currentModel: null,
  chatMode: 'normal',
  loading: false,
};

const canvasState = {
  docs: {} // conversationId -> doc
};

let canvasEditor = null;
let canvasMode = false;

// Score Canvas State - Collaborative music composition
const scoreCanvasState = {
  docs: {} // conversationId -> scoreDocument
};
let scoreCanvasMode = false;
let travelModeActive = false;
let musicMode = false;
let pendingScoreEdit = null; // For AI edit approval flow

// Control de scroll para burbujas (fuera del streaming principal)
const SCROLL_UPDATE_INTERVAL = 16; // ~60fps
let lastScrollUpdateTime = 0;

//Archivos adjuntos por conversación
const attachedFiles = {};

let currentStreamReader = null;
let wasCancelled = false;
let incognitoMode = false;
let stateBeforeIncognito = null; // Guardar el estado antes de entrar en modo incógnito

const hasLocalStorage = (() => {
  try {
    const key = '__ollama-web-test__';
    window.localStorage.setItem(key, '1');
    window.localStorage.removeItem(key);
    return true;
  } catch (error) {
    console.warn('LocalStorage no disponible', error);
    return false;
  }
})();

function generateId(prefix) {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function createMessage(role, content = '', attachedFilesList = []) {
  return {
    id: generateId('msg'),
    role,
    content,
    attachedFiles: attachedFilesList,
    createdAt: Date.now(),
  };
}

function ensureConversationOrder() {
  state.order = state.order.filter((id) => Boolean(state.conversations[id]));
  Object.keys(state.conversations)
    .filter((id) => !state.order.includes(id))
    .forEach((id) => state.order.push(id));
}

function persistState() {
  // No guardar nada si estamos en modo incógnito
  if (incognitoMode) return;

  if (!hasLocalStorage) return;
  const snapshot = {
    conversations: state.conversations,
    order: state.order,
    activeId: state.activeId,
    currentModel: state.currentModel,
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch (error) {
    console.warn('No se pudo guardar el estado', error);
  }
}

function loadState() {
  if (!hasLocalStorage) return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    state.conversations = parsed.conversations ?? {};
    state.order = Array.isArray(parsed.order) ? parsed.order : Object.keys(state.conversations);
    state.activeId = parsed.activeId ?? state.order[0] ?? null;
    state.currentModel = parsed.currentModel ?? null;
    ensureConversationOrder();
  } catch (error) {
    console.warn('No se pudo restaurar el estado', error);
  }
}

function persistCanvasState() {
  if (!hasLocalStorage) return;
  try {
    window.localStorage.setItem(CANVAS_STORAGE_KEY, JSON.stringify(canvasState));
  } catch (error) {
    console.warn('No se pudo guardar el estado de canvas', error);
  }
}

function loadCanvasState() {
  if (!hasLocalStorage) return;
  try {
    const raw = window.localStorage.getItem(CANVAS_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    canvasState.docs = parsed?.docs || {};
    canvasState.cards = parsed?.cards || {};
  } catch (error) {
    console.warn('No se pudo restaurar el estado de canvas', error);
  }
}

function getCanvasDoc(conversationId) {
  if (!conversationId) return null;
  return canvasState.docs[conversationId] || null;
}

function saveCanvasDoc(conversationId, doc) {
  if (!conversationId || !doc) return;
  canvasState.docs[conversationId] = doc;
  persistCanvasState();
}

function getCanvasCards(conversationId) {
  if (!conversationId) return [];
  return canvasState.cards[conversationId] || [];
}

function pushCanvasCard(conversationId, card) {
  if (!conversationId || !card) return;
  if (!canvasState.cards[conversationId]) canvasState.cards[conversationId] = [];
  canvasState.cards[conversationId].unshift(card);
  persistCanvasState();
}

// ===========================
// Score Canvas - State Management
// ===========================

function persistScoreCanvasState() {
  if (!hasLocalStorage || incognitoMode) return;
  try {
    window.localStorage.setItem(SCORE_CANVAS_STORAGE_KEY, JSON.stringify(scoreCanvasState));
  } catch (error) {
    console.warn('🎼 No se pudo guardar el estado de score canvas', error);
  }
}

function loadScoreCanvasState() {
  if (!hasLocalStorage) return;
  try {
    const raw = window.localStorage.getItem(SCORE_CANVAS_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    scoreCanvasState.docs = parsed?.docs || {};
    console.log('🎼 Score canvas state loaded');
  } catch (error) {
    console.warn('🎼 No se pudo restaurar el estado de score canvas', error);
  }
}

function getScoreDoc(conversationId) {
  if (!conversationId) return null;
  return scoreCanvasState.docs[conversationId] || null;
}

function saveScoreDoc(conversationId, doc) {
  if (!conversationId || !doc) return;
  scoreCanvasState.docs[conversationId] = doc;
  persistScoreCanvasState();
}

function createEmptyScore() {
  return {
    id: generateId('score'),
    abc: `X:1
T:Nueva Composición
M:4/4
L:1/4
Q:1/4=120
K:C
% Tu música va aquí
`,
    title: SCORE_CANVAS_DEFAULT_TITLE,
    key: 'C',
    meter: '4/4',
    tempo: '1/4=120',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    version: 1,
    versions: [],
    lastEditBy: 'user'
  };
}

function ensureScoreDoc(conversationId) {
  if (!conversationId) return null;
  let doc = getScoreDoc(conversationId);
  if (!doc) {
    doc = createEmptyScore();
    saveScoreDoc(conversationId, doc);
    console.log('🎼 Created new empty score for conversation:', conversationId);
  }
  return doc;
}

function updateScoreFromUser(conversationId, newAbc, newTitle = null) {
  const doc = ensureScoreDoc(conversationId);
  if (!doc) return;

  // Save current version to history
  doc.versions.push({
    version: doc.version,
    abc: doc.abc,
    title: doc.title,
    editedBy: doc.lastEditBy,
    timestamp: doc.updatedAt
  });

  // Update document
  doc.abc = newAbc;
  if (newTitle) doc.title = newTitle;
  doc.updatedAt = Date.now();
  doc.version += 1;
  doc.lastEditBy = 'user';

  // Parse metadata from ABC
  const meterMatch = newAbc.match(/^M:\s*(.+)$/m);
  const keyMatch = newAbc.match(/^K:\s*(.+)$/m);
  const tempoMatch = newAbc.match(/^Q:\s*(.+)$/m);
  const titleMatch = newAbc.match(/^T:\s*(.+)$/m);

  if (meterMatch) doc.meter = meterMatch[1].trim();
  if (keyMatch) doc.key = keyMatch[1].trim();
  if (tempoMatch) doc.tempo = tempoMatch[1].trim();
  if (titleMatch && !newTitle) doc.title = titleMatch[1].trim();

  saveScoreDoc(conversationId, doc);
  console.log('🎼 Score updated by user, now v' + doc.version);
  return doc;
}

function updateScoreFromAI(conversationId, scoreEdit) {
  const doc = ensureScoreDoc(conversationId);
  if (!doc) return;

  // Save current version to history
  doc.versions.push({
    version: doc.version,
    abc: doc.abc,
    title: doc.title,
    editedBy: doc.lastEditBy,
    timestamp: doc.updatedAt
  });

  // Update with AI's edit
  doc.abc = scoreEdit.abc;
  doc.title = scoreEdit.title || doc.title;
  doc.key = scoreEdit.key || doc.key;
  doc.meter = scoreEdit.meter || doc.meter;
  doc.tempo = scoreEdit.tempo || doc.tempo;
  doc.updatedAt = Date.now();
  doc.version += 1;
  doc.lastEditBy = 'ai';

  saveScoreDoc(conversationId, doc);
  console.log('🎼 Score updated by AI, now v' + doc.version);
  return doc;
}

function getScoreHistory(conversationId) {
  const doc = getScoreDoc(conversationId);
  if (!doc) return [];
  return doc.versions || [];
}

function restoreScoreVersion(conversationId, versionNumber) {
  const doc = getScoreDoc(conversationId);
  if (!doc) return null;

  const targetVersion = doc.versions.find(v => v.version === versionNumber);
  if (!targetVersion) return null;

  // Save current as a version before restoring
  doc.versions.push({
    version: doc.version,
    abc: doc.abc,
    title: doc.title,
    editedBy: doc.lastEditBy,
    timestamp: doc.updatedAt
  });

  // Restore the old version
  doc.abc = targetVersion.abc;
  doc.title = targetVersion.title;
  doc.updatedAt = Date.now();
  doc.version += 1;
  doc.lastEditBy = 'user'; // User initiated the restore

  saveScoreDoc(conversationId, doc);
  console.log('🎼 Restored to v' + versionNumber + ', now v' + doc.version);
  return doc;
}

function deleteScoreDoc(conversationId) {
  if (!conversationId) return;
  delete scoreCanvasState.docs[conversationId];
  persistScoreCanvasState();
}

function autoResizeTextarea(textarea) {
  if (!textarea) return;
  textarea.style.height = 'auto';
  textarea.style.height = `${textarea.scrollHeight}px`;
}

function scrollChatToBottom() {
  requestAnimationFrame(() => {
    chatList?.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  });
}

function touchConversation(id) {
  const conversation = state.conversations[id];
  if (!conversation) return;
  conversation.updatedAt = Date.now();
  const index = state.order.indexOf(id);
  if (index > 0) {
    state.order.splice(index, 1);
    state.order.unshift(id);
  } else if (index === -1) {
    state.order.unshift(id);
  }
}

function updateConversationTitleFromContent(conversation) {
  if (!conversation) return;

  // Solo actualizar si el título es el predeterminado (o su traducción)
  const currentTitle = conversation.title;
  const isDefault = !currentTitle ||
    currentTitle === 'Nueva conversación' ||
    currentTitle === 'New Conversation' ||
    currentTitle === DEFAULT_TITLE;

  if (!isDefault) return;

  const firstUserMessage = conversation.messages.find((msg) => msg.role === 'user');
  if (!firstUserMessage) return;
  const trimmed = firstUserMessage.content.trim();
  if (!trimmed) return;
  conversation.title = trimmed.length > 42 ? `${trimmed.slice(0, 42)}…` : trimmed;
}



function formatRelativeTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (!window.translationManager) {
    if (diff < minute) return 'Actualizado hace unos segundos';
    if (diff < hour) return `Actualizado hace ${Math.floor(diff / minute)} min`;
    if (diff < day) return `Actualizado hace ${Math.floor(diff / hour)} h`;
    if (diff < 2 * day) return 'Ayer';
    return date.toLocaleDateString();
  }

  if (diff < minute) return window.translationManager.translate('time.justNow');
  if (diff < hour) return window.translationManager.translate('time.minutesAgo', { minutes: Math.floor(diff / minute) });
  if (diff < day) return window.translationManager.translate('time.hoursAgo', { hours: Math.floor(diff / hour) });
  if (diff < 2 * day) return window.translationManager.translate('time.yesterday');
  return date.toLocaleDateString();
}

function formatTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

// ===========================
// Canvas helpers - Simplificado estilo Claude
// ===========================

function toggleCanvasVisibility(show) {
  if (!canvasPanel) return;
  canvasPanel.style.display = show ? 'flex' : 'none';
  document.body.classList.toggle('canvas-visible', show);
}

function extractJsonFromText(text) {
  if (!text) return null;

  // Limpiar bloques de código markdown si existen
  let cleanText = text;
  const codeBlockMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1];
  }

  const start = text.indexOf('{');
  if (start === -1) return null;

  let balance = 0;
  let end = -1;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === '\\') {
      escape = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{') balance++;
      else if (char === '}') {
        balance--;
        if (balance === 0) {
          end = i;
          break;
        }
      }
    }
  }

  if (end !== -1) {
    return text.substring(start, end + 1);
  }
  return null;
}

function ensureCanvasDoc(conversationId, payload = {}) {
  if (!conversationId) return null;
  let doc = getCanvasDoc(conversationId);
  if (!doc) {
    doc = {
      id: generateId('canvas'),
      title: payload.title || CANVAS_DEFAULT_TITLE,
      content: payload.content || '',
      contentType: payload.content_type || 'document',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      version: 1,
      versions: [] // Historial de versiones
    };
    saveCanvasDoc(conversationId, doc);
  }
  return doc;
}

// Flag para evitar duplicar el listener del canvas editor
let canvasEditorListenerAdded = false;

function updateCanvasPreview(markdownContent) {
  const previewEl = document.getElementById('canvas-preview');
  if (!previewEl) return;

  // Convertir markdown a HTML
  let htmlContent = '';
  if (typeof marked !== 'undefined') {
    try {
      htmlContent = marked.parse(markdownContent || '');
    } catch (e) {
      console.error('Error parseando markdown:', e);
      htmlContent = markdownContent || '';
    }
  } else {
    htmlContent = markdownContent || '';
  }

  previewEl.innerHTML = htmlContent;

  // Renderizar fórmulas matemáticas si KaTeX está disponible
  if (typeof renderMathInElement !== 'undefined') {
    try {
      renderMathInElement(previewEl, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false }
        ],
        throwOnError: false
      });
    } catch (e) {
      console.error('Error renderizando matemáticas:', e);
    }
  }
}

function initCanvasEditor(content = '', readOnly = false) {
  const editorEl = document.getElementById('canvas-editor');
  if (!editorEl) return;

  // El canvas-editor es un textarea, usar value en vez de innerHTML
  editorEl.value = content || '';
  editorEl.readOnly = readOnly;

  // Cambiar estilo si es solo lectura
  if (readOnly) {
    editorEl.style.opacity = '0.7';
    editorEl.style.cursor = 'not-allowed';
    editorEl.placeholder = 'Versión anterior (solo lectura)';
  } else {
    editorEl.style.opacity = '1';
    editorEl.style.cursor = 'text';
    editorEl.placeholder = 'Escribe aquí tu contenido en Markdown...';
  }

  // Actualizar la vista previa inicial
  updateCanvasPreview(content);

  // Añadir listener solo una vez
  if (!canvasEditorListenerAdded) {
    editorEl.addEventListener('input', () => {
      // No permitir edición si es solo lectura
      if (editorEl.readOnly) return;

      const conversation = state.conversations[state.activeId];
      if (!conversation) return;
      const doc = getCanvasDoc(conversation.id);
      if (!doc) return;
      doc.content = editorEl.value;
      doc.updatedAt = Date.now();
      saveCanvasDoc(conversation.id, doc);

      // Actualizar vista previa en tiempo real
      updateCanvasPreview(editorEl.value);
    });
    canvasEditorListenerAdded = true;
  }
}

function getCanvasContent() {
  const editorEl = document.getElementById('canvas-editor');
  return editorEl?.value || '';
}

function renderCanvasPanel(conversationId, versionNumber = null) {
  const doc = getCanvasDoc(conversationId);
  if (!doc) {
    toggleCanvasVisibility(false);
    return;
  }

  // Si se especifica una versión, cargar esa versión
  let contentToShow = doc.content;
  let titleToShow = doc.title;
  let isOldVersion = false;

  if (versionNumber && versionNumber < (doc.version || 1)) {
    // Buscar la versión en el historial
    const versionData = doc.versions?.find(v => v.version === versionNumber);
    if (versionData) {
      contentToShow = versionData.content;
      titleToShow = versionData.title;
      isOldVersion = true;
    }
  }

  toggleCanvasVisibility(true);
  if (canvasTitleInput) {
    canvasTitleInput.value = (isOldVersion ? `${titleToShow} (v${versionNumber})` : titleToShow) || CANVAS_DEFAULT_TITLE;

    if (!isOldVersion) {
      canvasTitleInput.addEventListener('input', () => {
        doc.title = canvasTitleInput.value;
        doc.updatedAt = Date.now();
        saveCanvasDoc(conversationId, doc);
      });
    }
  }

  initCanvasEditor(contentToShow || '', isOldVersion);

  // Guardar la versión actual que se está visualizando
  doc.currentViewVersion = versionNumber || doc.version || 1;
}

function parseCanvasPayload(content) {
  if (!content) return null;
  let candidate = content.trim();

  // Limpiar bloques de código markdown
  candidate = candidate.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  // Buscar JSON con type canvas - regex más flexible
  let jsonMatch = candidate.match(/\{[^{}]*"type"\s*:\s*["']canvas["'][^{}]*\}/s);
  if (!jsonMatch) {
    // Intentar buscar JSON anidado más complejo
    jsonMatch = candidate.match(/\{[\s\S]*?"type"\s*:\s*["']canvas["'][\s\S]*?\}(?=\s*[^{]|$)/);
  }

  if (jsonMatch) {
    candidate = jsonMatch[0];
  } else {
    // Último intento: buscar cualquier JSON
    jsonMatch = candidate.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      candidate = jsonMatch[0];
    }
  }

  // Intentar parsear como JSON
  try {
    const parsed = JSON.parse(candidate);
    if (parsed.type === 'canvas') {
      return parsed;
    }
  } catch (e) {
    // Fallback con regex para extraer campos
    const typeMatch = candidate.match(/"type"\s*:\s*["']([^"']+)["']/);
    const ctypeMatch = candidate.match(/"content_type"\s*:\s*["']([^"']+)["']/);
    const titleMatch = candidate.match(/"title"\s*:\s*["']([^"']*)["']/);

    // Regex mejorado para contenido - maneja escapes y multilinea
    let contentValue = null;
    const contentMatch = candidate.match(/"content"\s*:\s*"((?:[^"\\]|\\.)*)"/s);
    if (contentMatch) {
      contentValue = contentMatch[1]
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    }

    if (typeMatch && typeMatch[1] === 'canvas' && contentValue !== null) {
      return {
        type: 'canvas',
        content_type: ctypeMatch ? ctypeMatch[1] : 'document',
        title: titleMatch ? titleMatch[1] : CANVAS_DEFAULT_TITLE,
        content: contentValue,
        actions: ['edit']
      };
    }
  }

  return null;
}

function detectCanvasIntent(prompt) {
  if (!prompt) return false;
  const keywords = ['crea un documento', 'hazme apuntes', 'redacta', 'escribe un artículo', 'apuntes', 'documento', 'tabla', 'presentación', 'slides', 'canvas', 'artifact'];
  const lower = prompt.toLowerCase();
  return keywords.some(k => lower.includes(k));
}

function createArtifactCard(payload) {
  const preview = stripHtml(payload.content).slice(0, 150) + '...';
  const versionBadge = payload.version ? `<span class="artifact-version">v${payload.version}</span>` : '';

  return `
    <div class="artifact-card" data-canvas-id="${payload.canvasId || ''}" data-canvas-version="${payload.version || 1}">
      <div class="artifact-card-header">
        <svg class="artifact-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <path d="M14 2v6h6"/>
          <path d="M16 13H8"/>
          <path d="M16 17H8"/>
          <path d="M10 9H8"/>
        </svg>
        <span class="artifact-title">${escapeHtml(payload.title || 'Documento')}</span>
        ${versionBadge}
      </div>
      <div class="artifact-preview">${escapeHtml(preview)}</div>
      <div class="artifact-action">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
          <polyline points="15 3 21 3 21 9"/>
          <line x1="10" y1="14" x2="21" y2="3"/>
        </svg>
        Ver versión v${payload.version || 1}
      </div>
    </div>
  `;
}

function createScoreArtifactCard(payload) {
  const versionBadge = payload.version ? `<span class="artifact-version">v${payload.version}</span>` : '';
  const meter = payload.meter || '4/4';
  const key = payload.key || 'C';
  const tempo = payload.tempo || '120';

  return `
    <div class="artifact-card score-artifact-card" data-score-id="${payload.scoreId || ''}" data-score-version="${payload.version || 1}">
      <div class="artifact-card-header">
        <svg class="artifact-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 18V5l12-2v13"/>
          <circle cx="6" cy="18" r="3"/>
          <circle cx="18" cy="16" r="3"/>
        </svg>
        <span class="artifact-title">${escapeHtml(payload.title || 'Partitura')}</span>
        ${versionBadge}
      </div>
      <div class="artifact-preview score-metadata">
        <span>🎵 ${meter}</span>
        <span>🎹 ${key}</span>
        <span>⏱ ${tempo} BPM</span>
      </div>
      <div class="artifact-action">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
          <polyline points="15 3 21 3 21 9"/>
          <line x1="10" y1="14" x2="21" y2="3"/>
        </svg>
        Ver partitura v${payload.version || 1}
      </div>
    </div>
  `;
}

function applyCanvasPayload(conversation, payload) {
  const doc = ensureCanvasDoc(conversation.id, payload);
  // Guardar el contenido como markdown plano (el textarea lo mostrará directamente)
  let content = payload.content || '';

  // Si el contenido es diferente, guardar versión anterior
  if (doc.content && doc.content !== content) {
    // Guardar versión anterior en el historial
    if (!doc.versions) doc.versions = [];
    doc.versions.push({
      version: doc.version || 1,
      title: doc.title,
      content: doc.content,
      timestamp: doc.updatedAt || Date.now()
    });

    // Incrementar número de versión
    doc.version = (doc.version || 1) + 1;
  }

  doc.title = payload.title || doc.title || CANVAS_DEFAULT_TITLE;
  doc.contentType = payload.content_type || 'document';
  doc.content = content;
  doc.updatedAt = Date.now();
  saveCanvasDoc(conversation.id, doc);
  renderCanvasPanel(conversation.id);

  return doc.id;
}

// Procesar respuesta con canvas estilo Claude
function processCanvasResponse(conversation, assistantMessage) {
  if (!conversation || !assistantMessage?.content) return false;

  const payload = parseCanvasPayload(assistantMessage.content);
  if (!payload) return false;

  // Obtener el documento actual para ver si es una actualización
  const existingDoc = getCanvasDoc(conversation.id);
  const isUpdate = existingDoc && existingDoc.content && existingDoc.content !== payload.content;

  // Aplicar el canvas y obtener su ID
  const canvasId = applyCanvasPayload(conversation, payload);

  // Obtener la versión actualizada
  const updatedDoc = getCanvasDoc(conversation.id);
  const currentVersion = updatedDoc?.version || 1;

  // Añadir versión al payload para la tarjeta
  payload.canvasId = canvasId;
  payload.version = currentVersion;

  // Limpiar el JSON del contenido del mensaje
  // Buscar y eliminar todo el bloque JSON (incluyendo bloques de código markdown)
  let cleanContent = assistantMessage.content;

  // Eliminar bloques ```json ... ```
  cleanContent = cleanContent.replace(/```json\s*\{[\s\S]*?\}\s*```/g, '');

  // Eliminar JSON sin bloques de código
  cleanContent = cleanContent.replace(/\{[\s\S]*?"type"\s*:\s*["']canvas["'][\s\S]*?\}/g, '');

  // Limpiar espacios en blanco excesivos
  cleanContent = cleanContent.replace(/\n{3,}/g, '\n\n').trim();

  // Si después de limpiar queda texto útil, usarlo; sino crear mensaje por defecto
  let explanation = '';
  if (cleanContent && cleanContent.length > 10 && !cleanContent.match(/^\s*$/)) {
    // Hay texto explicativo del modelo, usarlo
    // Insertar el marcador de artifact al principio si no existe
    if (!cleanContent.includes('[CANVAS_ARTIFACT]')) {
      explanation = `[CANVAS_ARTIFACT]\n\n${cleanContent}`;
    } else {
      explanation = cleanContent;
    }
  } else {
    // No hay texto explicativo, crear mensaje por defecto
    if (isUpdate) {
      explanation = `He actualizado el documento "${payload.title}" (v${currentVersion}).\n\n[CANVAS_ARTIFACT]\n\n`;
      explanation += `Los cambios se han aplicado al documento en el panel de la derecha. `;
    } else {
      explanation = `He creado el documento "${payload.title}" (v${currentVersion}).\n\n[CANVAS_ARTIFACT]\n\n`;

      // Agregar breve descripción de lo que se hizo
      if (payload.content_type === 'code') {
        explanation += `Este es un código que puedes revisar y editar en el panel de la derecha. `;
      } else {
        explanation += `Este documento está disponible en el panel de la derecha para que puedas revisarlo y editarlo. `;
      }
    }

    explanation += `Puedes pedirme que lo modifique o amplíe en cualquier momento.`;
  }

  assistantMessage.content = explanation;
  assistantMessage.canvasId = canvasId;
  assistantMessage.canvasVersion = currentVersion;

  return true;
}

// Construir instrucción para el modelo cuando se trabaja con canvas
function buildCanvasInstruction(doc, userPrompt) {
  let docContext = '';
  let versionInfo = '';

  if (doc?.content) {
    const plainText = stripHtml(doc.content).slice(0, 2000); // Limitar contexto
    const currentVersion = doc.version || 1;
    const viewingVersion = doc.currentViewVersion || currentVersion;

    versionInfo = `\n\nVersión actual del documento: v${currentVersion}`;
    if (viewingVersion < currentVersion) {
      versionInfo += `\nEl usuario está viendo la versión: v${viewingVersion} (versión anterior)`;
      versionInfo += `\nSi el usuario pide modificaciones, se aplicarán sobre la versión más reciente (v${currentVersion}), no sobre la versión que está viendo.`;
    }

    docContext = `${versionInfo}\n\nContenido del documento (v${viewingVersion}):\n${plainText}`;
  }

  return `Cuando el usuario pida crear, redactar o modificar un documento, responde con JSON válido en este formato:

{
  "type": "canvas",
  "content_type": "document",
  "title": "Título descriptivo del documento",
  "content": "Contenido en formato Markdown",
  "actions": ["edit"]
}

El contenido debe estar en Markdown.
IMPORTANTE: Envía PRIMERO el JSON y DESPUÉS una explicación breve de los cambios realizados o del documento creado.
No incluyas texto antes del JSON.${docContext}`;
}

function stripHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html || '';
  return (tmp.textContent || '').trim();
}

// ========================================
// PDF Source References System
// ========================================

// Parse source references and convert to clickable badges
function parseSourceReferences(content) {
  if (!content) return content;

  // Match [[FUENTE:filename.pdf:"quoted text"]]
  const sourceRegex = /\[\[FUENTE:([^:]+):"([^"]+)"\]\]/g;

  return content.replace(sourceRegex, (match, fileName, citedText) => {
    const safeFileName = escapeHtml(fileName.trim());
    const safeCitedText = escapeHtml(citedText.trim());

    return `<span class="source-badge" 
                  data-file="${safeFileName}" 
                  data-text="${safeCitedText}"
                  onclick="window.openPdfViewer('${safeFileName.replace(/'/g, "\\'")}', '${safeCitedText.replace(/'/g, "\\'")}')"
                  title="Ver fuente: ${safeFileName}">
              <span class="source-badge-icon">📄</span>
              <span class="source-badge-name">${safeFileName}</span>
            </span>`;
  });
}

// State for PDF viewer
let pdfViewerState = {
  currentPdf: null,
  currentFile: null,
  scale: 1.2
};

// Open PDF viewer panel with highlighted text
window.openPdfViewer = async function (fileName, textToHighlight) {
  const project = getActiveProject();
  if (!project) {
    console.warn('No hay proyecto activo');
    return;
  }

  // Find the file in project - try exact match first, then flexible match
  let file = project.files.find(f => f.name === fileName);

  // If not found, try flexible comparison (normalize accents, case, hyphens/spaces)
  if (!file) {
    const normalizeFileName = (name) => {
      return name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Remove accents
        .replace(/[-_]/g, ' ')           // Convert hyphens/underscores to spaces
        .replace(/\s+/g, ' ')            // Normalize multiple spaces
        .trim();
    };

    const normalizedSearch = normalizeFileName(fileName);
    file = project.files.find(f => {
      const normalizedName = normalizeFileName(f.name);
      return normalizedName === normalizedSearch ||
        normalizedName.includes(normalizedSearch) ||
        normalizedSearch.includes(normalizedName);
    });
  }

  if (!file) {
    console.warn(`Archivo no encontrado: ${fileName}`);
    console.log('Archivos disponibles en el proyecto:', project.files.map(f => f.name));
    return;
  }

  // Get panel elements
  const panel = document.getElementById('pdf-viewer-panel');
  const filenameEl = document.getElementById('pdf-viewer-filename');
  const highlightTextEl = document.getElementById('pdf-highlight-text');
  const container = document.getElementById('pdf-viewer-container');

  if (!panel || !container) {
    console.warn('Panel de visor de PDF no encontrado');
    return;
  }

  // Show panel
  panel.style.display = 'flex';
  document.body.classList.add('pdf-viewer-visible');

  // Update header info
  if (filenameEl) filenameEl.textContent = fileName;
  if (highlightTextEl) highlightTextEl.textContent = `"${textToHighlight}"`;

  // Show loading state
  container.innerHTML = '<div class="pdf-loading"><div class="loading-spinner"></div><span>Cargando PDF...</span></div>';

  try {
    // Always load the content (since we're showing extracted text, it's fast)
    await loadPdfIntoViewer(file, container, textToHighlight);
    pdfViewerState.currentFile = fileName;

  } catch (error) {
    console.error('Error al cargar PDF:', error);
    container.innerHTML = `<div class="pdf-error">
      <span class="error-icon">⚠️</span>
      <span>Error al cargar el PDF: ${error.message}</span>
    </div>`;
  }
};

// Render PDF visually with selectable text layer and highlighting
async function renderPdfVisually(base64Data, container, textToHighlight) {
  const isLoaded = await waitForPdfJs();
  if (!isLoaded) throw new Error('PDF.js no disponible');

  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  // Decode base64 to binary
  const base64 = base64Data.split(',')[1];
  const pdfData = atob(base64);
  const bytes = new Uint8Array(pdfData.length);
  for (let i = 0; i < pdfData.length; i++) {
    bytes[i] = pdfData.charCodeAt(i);
  }

  // Load PDF document
  const loadingTask = pdfjsLib.getDocument({ data: bytes });
  const pdf = await loadingTask.promise;
  pdfViewerState.currentPdf = pdf;

  container.innerHTML = '';

  // =====================================================
  // IMPROVED TEXT SEARCH ALGORITHM - Multi-strategy approach
  // =====================================================

  // Advanced text normalization function
  const normalizeText = (text) => {
    if (!text) return '';
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove accents
      .replace(/[""''«»]/g, '"')       // Normalize quotes
      .replace(/[—–]/g, '-')           // Normalize dashes
      .replace(/\s+/g, ' ')            // Normalize whitespace
      .replace(/[.,;:!?()[\]{}]/g, ' ') // Remove punctuation
      .replace(/\s+/g, ' ')            // Clean up spaces again
      .trim();
  };

  // Extract significant words (length > 3, not common stopwords)
  const stopwords = new Set(['para', 'como', 'esta', 'este', 'esto', 'esos', 'esas', 'unos', 'unas',
    'cada', 'todo', 'toda', 'todos', 'todas', 'pero', 'sino', 'porque', 'cuando', 'donde',
    'quien', 'cual', 'cuyo', 'cuya', 'algo', 'nada', 'mucho', 'poco', 'otro', 'otra',
    'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one',
    'our', 'out', 'has', 'have', 'been', 'were', 'from', 'this', 'that', 'with', 'they', 'what']);

  const extractKeywords = (text) => {
    const normalized = normalizeText(text);
    return normalized.split(' ')
      .filter(w => w.length > 3 && !stopwords.has(w))
      .slice(0, 20); // Limit to 20 most important words
  };

  // Generate n-grams (sequences of consecutive words)
  const generateNgrams = (text, n) => {
    const words = normalizeText(text).split(' ').filter(w => w.length > 2);
    const ngrams = [];
    for (let i = 0; i <= words.length - n; i++) {
      ngrams.push(words.slice(i, i + n).join(' '));
    }
    return ngrams;
  };

  // Prepare search data
  const normalizedSearch = textToHighlight ? normalizeText(textToHighlight) : '';
  const searchKeywords = extractKeywords(textToHighlight || '');
  const searchNgrams4 = generateNgrams(textToHighlight || '', 4);
  const searchNgrams3 = generateNgrams(textToHighlight || '', 3);
  const searchFragments = normalizedSearch.length > 30
    ? [normalizedSearch.substring(0, 40), normalizedSearch.substring(normalizedSearch.length - 40)]
    : [normalizedSearch];

  console.log('🔍 PDF Search - Full text:', textToHighlight?.substring(0, 100));
  console.log('🔍 PDF Search - Keywords:', searchKeywords.slice(0, 10));
  console.log('🔍 PDF Search - N-grams (4):', searchNgrams4.slice(0, 5));

  let foundPageDiv = null;
  let foundPageNum = 0;
  let bestScore = 0;
  let matchMethod = '';

  // Track page scores for multi-strategy matching
  const pageScores = [];

  // Render all pages
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const scale = 1.5;
    const viewport = page.getViewport({ scale });

    // Create page wrapper
    const pageDiv = document.createElement('div');
    pageDiv.className = 'pdf-page';
    pageDiv.dataset.pageNum = pageNum;
    pageDiv.style.cssText = `
      position: relative;
      margin-bottom: 16px;
      background: white;
      box-shadow: 0 2px 10px rgba(0,0,0,0.2);
      border-radius: 4px;
      overflow: hidden;
      width: ${viewport.width}px;
      max-width: 100%;
    `;

    // Create canvas container (maintains aspect ratio)
    const canvasWrapper = document.createElement('div');
    const aspectRatio = (viewport.height / viewport.width) * 100;
    canvasWrapper.style.cssText = `
      position: relative;
      width: 100%;
    `;

    // Create canvas for rendering PDF graphics
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    canvas.style.cssText = `
      display: block;
      width: 100%;
      height: auto;
    `;

    // Render PDF page to canvas
    await page.render({ canvasContext: context, viewport: viewport }).promise;
    canvasWrapper.appendChild(canvas);

    // Get text content for this page
    const textContent = await page.getTextContent();
    const pageTextItems = textContent.items;

    // Create text layer for selectable text using PDF.js official API
    const textLayerDiv = document.createElement('div');
    textLayerDiv.className = 'pdf-text-layer';
    textLayerDiv.style.cssText = `
      position: absolute;
      left: 0;
      top: 0;
      right: 0;
      bottom: 0;
      overflow: hidden;
      line-height: 1;
      user-select: text;
      cursor: text;
      transform-origin: 0% 0%;
    `;

    // Use the official PDF.js TextLayer rendering API
    // This properly handles font scaling and positioning
    const textLayerRenderTask = pdfjsLib.renderTextLayer({
      textContentSource: textContent,
      container: textLayerDiv,
      viewport: viewport,
      textDivs: []
    });

    await textLayerRenderTask.promise;

    // Note: We removed the individual word highlighting as it was too aggressive
    // The page banner will indicate where the cited text was found

    canvasWrapper.appendChild(textLayerDiv);
    pageDiv.appendChild(canvasWrapper);

    // =====================================================
    // MULTI-STRATEGY TEXT MATCHING
    // =====================================================
    const fullPageText = pageTextItems.map(item => item.str).join(' ');
    const normalizedPageText = normalizeText(fullPageText);

    let pageScore = 0;
    let pageMatchMethods = [];

    if (normalizedSearch) {
      // Strategy 1: Exact match (highest priority)
      if (normalizedPageText.includes(normalizedSearch)) {
        pageScore += 100;
        pageMatchMethods.push('exact');
      }

      // Strategy 2: Fragment match (beginning and end of cited text)
      for (const fragment of searchFragments) {
        if (fragment.length > 10 && normalizedPageText.includes(fragment)) {
          pageScore += 50;
          pageMatchMethods.push('fragment');
          break;
        }
      }

      // Strategy 3: N-gram match (sequences of 4 words)
      for (const ngram of searchNgrams4) {
        if (normalizedPageText.includes(ngram)) {
          pageScore += 30;
          pageMatchMethods.push('ngram4');
          break;
        }
      }

      // Strategy 4: N-gram match (sequences of 3 words)
      for (const ngram of searchNgrams3) {
        if (normalizedPageText.includes(ngram)) {
          pageScore += 20;
          pageMatchMethods.push('ngram3');
          break;
        }
      }

      // Strategy 5: Keyword density (how many keywords found)
      const keywordsFound = searchKeywords.filter(kw => normalizedPageText.includes(kw));
      const keywordRatio = keywordsFound.length / Math.max(searchKeywords.length, 1);
      if (keywordRatio >= 0.5) {
        pageScore += Math.round(keywordRatio * 40);
        pageMatchMethods.push(`keywords(${keywordsFound.length}/${searchKeywords.length})`);
      }
    }

    // Store page score
    pageScores.push({ pageNum, pageDiv, score: pageScore, methods: pageMatchMethods });

    if (pageScore > 0) {
      console.log(`📄 Page ${pageNum} score: ${pageScore} [${pageMatchMethods.join(', ')}]`);
    }

    // Add page number footer
    const pageFooter = document.createElement('div');
    pageFooter.style.cssText = `
      text-align: center;
      padding: 8px;
      color: rgba(255,255,255,0.6);
      font-size: 12px;
      background: rgba(0,0,0,0.4);
    `;
    pageFooter.textContent = `Página ${pageNum} de ${pdf.numPages}`;
    pageDiv.appendChild(pageFooter);

    container.appendChild(pageDiv);
  }

  // =====================================================
  // FIND BEST MATCHING PAGE
  // =====================================================
  if (normalizedSearch && pageScores.length > 0) {
    // Sort by score descending
    pageScores.sort((a, b) => b.score - a.score);
    const bestPage = pageScores[0];

    if (bestPage.score > 0) {
      foundPageDiv = bestPage.pageDiv;
      foundPageNum = bestPage.pageNum;
      matchMethod = bestPage.methods.join(', ');
      bestScore = bestPage.score;

      console.log(`✅ Best match: Page ${foundPageNum} with score ${bestScore} [${matchMethod}]`);

      // Add found banner to best matching page
      const banner = document.createElement('div');
      banner.className = 'pdf-found-banner';
      const confidenceText = bestScore >= 100 ? 'Coincidencia exacta' :
        bestScore >= 50 ? 'Alta coincidencia' : 'Coincidencia parcial';
      banner.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style="vertical-align: -1px; margin-right: 4px; opacity: 0.9;"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"/></svg>Pág. ${foundPageNum} · ${confidenceText}`;
      banner.style.cssText = `
        position: absolute;
        top: 0;
        left: 50%;
        transform: translateX(-50%);
        background: ${bestScore >= 100 ? '#4caf50' : bestScore >= 50 ? 'var(--theme-primary, #ff9800)' : '#2196f3'};
        color: white;
        padding: 6px 14px;
        font-size: 11px;
        font-weight: 500;
        text-align: center;
        z-index: 100;
        border-radius: 0 0 8px 8px;
        box-shadow: 0 2px 6px rgba(0,0,0,0.2);
      `;
      foundPageDiv.appendChild(banner);
    } else {
      console.log('❌ No matching text found in any page');
      console.log('🔍 Search text was:', textToHighlight?.substring(0, 100));
    }
  }

  // Scroll to found page
  if (foundPageDiv) {
    console.log(`📜 Scrolling to page ${foundPageNum}`);
    setTimeout(() => {
      foundPageDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 200);
  }
}

// Load PDF into viewer container
async function loadPdfIntoViewer(file, container, textToHighlight) {
  // Debug: Log what we have in the file
  console.log('📄 PDF Viewer - Loading file:', {
    name: file.name,
    id: file.id,
    hasPdfBinary: file.hasPdfBinary,
    hasContent: !!file.content,
    contentStart: file.content?.substring(0, 50),
    isPDF: file.isPDF
  });

  // Check if no content at all
  // Check if no content at all
  if (!file.content && !file.hasPdfBinary && !file.pdfBinary) {
    container.innerHTML = '<div class="pdf-error"><span class="error-icon">⚠️</span><span>Sin contenido disponible</span></div>';
    return;
  }

  // NEW FORMAT: Load PDF binary from IndexedDB
  if (file.hasPdfBinary && file.id) {
    try {
      console.log('📄 Loading PDF from IndexedDB:', file.id);
      const pdfBinary = await getPdfFromIndexedDB(file.id);
      if (pdfBinary && pdfBinary.startsWith('data:application/pdf')) {
        console.log('📄 ✅ Rendering PDF visually from IndexedDB');
        await renderPdfVisually(pdfBinary, container, textToHighlight);
        return;
      } else {
        console.warn('📄 ⚠️ PDF binary not found in IndexedDB, falling back to text');
      }
    } catch (e) {
      console.warn('📄 ⚠️ Could not load PDF from IndexedDB:', e);
    }
  }

  // LEGACY: Check if file has pdfBinary directly (old storage format)
  if (file.pdfBinary && file.pdfBinary.startsWith('data:application/pdf')) {
    try {
      console.log('📄 ✅ Rendering PDF visually from legacy pdfBinary');
      await renderPdfVisually(file.pdfBinary, container, textToHighlight);
      return;
    } catch (e) {
      console.warn('📄 ⚠️ Could not render PDF binary:', e);
    }
  }

  // LEGACY: Check if content itself is base64 PDF data
  if (file.content && file.content.startsWith('data:application/pdf')) {
    try {
      console.log('📄 ✅ Rendering PDF visually from content');
      await renderPdfVisually(file.content, container, textToHighlight);
      return;
    } catch (e) {
      console.warn('📄 ⚠️ Could not render PDF binary:', e);
    }
  }

  // FALLBACK: Show text content (PDF was uploaded before visual support)
  console.log('📄 ⚠️ No PDF binary available, showing extracted text');
  console.log('📄 💡 TIP: Re-upload the PDF to enable visual rendering');
  // Text content view (extracted text from PDF) - FALLBACK
  container.innerHTML = '';
  const textView = document.createElement('div');
  textView.className = 'pdf-text-view';

  // Process text to highlight the cited text
  let displayContent = file.content || 'Sin contenido disponible';

  if (textToHighlight) {
    // Use improved search with normalization
    const normalizeForSearch = (text) => {
      if (!text) return '';
      return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    };

    const normalizedSearch = normalizeForSearch(textToHighlight);
    const normalizedContent = normalizeForSearch(displayContent);
    let index = normalizedContent.indexOf(normalizedSearch);

    // If exact match not found, try finding key phrases (first 30 chars, last 30 chars)
    if (index === -1 && normalizedSearch.length > 30) {
      const startPhrase = normalizedSearch.substring(0, 30);
      const endPhrase = normalizedSearch.substring(normalizedSearch.length - 30);

      index = normalizedContent.indexOf(startPhrase);
      if (index === -1) {
        index = normalizedContent.indexOf(endPhrase);
      }
    }

    // If still not found, try with keywords
    if (index === -1) {
      const keywords = normalizedSearch.split(' ').filter(w => w.length > 4).slice(0, 5);
      for (const kw of keywords) {
        const kwIndex = normalizedContent.indexOf(kw);
        if (kwIndex !== -1) {
          // Find surrounding context
          const contextStart = Math.max(0, kwIndex - 50);
          const contextEnd = Math.min(normalizedContent.length, kwIndex + kw.length + 50);
          // Map to original content
          index = contextStart;
          break;
        }
      }
    }

    if (index !== -1) {
      // Find the best match length (could be partial match)
      const matchLength = Math.min(textToHighlight.length, displayContent.length - index);
      const before = escapeHtml(displayContent.substring(0, index));
      const match = escapeHtml(displayContent.substring(index, index + matchLength));
      const after = escapeHtml(displayContent.substring(index + matchLength));
      displayContent = `${before}<mark class="pdf-highlight">${match}</mark>${after}`;
    } else {
      displayContent = escapeHtml(displayContent);
    }
  } else {
    displayContent = escapeHtml(displayContent);
  }

  textView.innerHTML = `
    <div class="pdf-text-header">
      <span class="pdf-text-icon">📄</span>
      <span>Contenido extraído de: ${escapeHtml(file.name)}</span>
    </div>
    <div class="pdf-text-content">${displayContent}</div>
  `;
  container.appendChild(textView);

  // Scroll to highlighted text
  setTimeout(() => {
    const highlight = container.querySelector('.pdf-highlight');
    if (highlight) {
      highlight.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, 100);
}

// Highlight text in PDF viewer
async function highlightTextInPdf(container, searchText) {
  if (!searchText || !container) return;

  const pages = container.querySelectorAll('.pdf-page');
  const normalizedSearch = searchText.toLowerCase().trim();

  // Remove existing highlights
  container.querySelectorAll('.pdf-highlight').forEach(el => el.remove());

  // For text-view mode (extracted text)
  const textView = container.querySelector('.pdf-text-content');
  if (textView) {
    const content = textView.textContent;
    const index = content.toLowerCase().indexOf(normalizedSearch);

    if (index !== -1) {
      const before = escapeHtml(content.substring(0, index));
      const match = escapeHtml(content.substring(index, index + searchText.length));
      const after = escapeHtml(content.substring(index + searchText.length));

      textView.innerHTML = `${before}<mark class="pdf-highlight">${match}</mark>${after}`;

      // Scroll to highlight
      const highlight = textView.querySelector('.pdf-highlight');
      if (highlight) {
        highlight.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
    return;
  }

  // For actual PDF pages
  for (const page of pages) {
    const textContent = (page.dataset.textContent || '').toLowerCase();

    if (textContent.includes(normalizedSearch)) {
      // Found the text in this page - scroll to it
      page.scrollIntoView({ behavior: 'smooth', block: 'start' });

      // Add visual indicator
      const indicator = document.createElement('div');
      indicator.className = 'pdf-highlight-indicator';
      indicator.innerHTML = `<span class="highlight-pulse"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="vertical-align: -2px; margin-right: 6px;"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"/></svg>Texto encontrado en esta página</span>`;
      page.insertBefore(indicator, page.firstChild);

      // Remove indicator after animation
      setTimeout(() => indicator.remove(), 5000);

      break;
    }
  }
}

// Close PDF viewer
window.closePdfViewer = function () {
  const panel = document.getElementById('pdf-viewer-panel');
  if (panel) {
    panel.style.display = 'none';
  }
  document.body.classList.remove('pdf-viewer-visible');
};

function parseMarkdown(text) {
  if (!text) return '';

  // Configurar marked y highlight.js una sola vez
  if (!window.markedConfigured && typeof marked !== 'undefined' && typeof hljs !== 'undefined') {
    marked.use({
      renderer: {
        code({ text, lang }) {
          const validLanguage = hljs.getLanguage(lang) ? lang : 'plaintext';
          let highlighted;
          try {
            highlighted = hljs.highlight(text, { language: validLanguage }).value;
          } catch (e) {
            highlighted = text;
          }

          return `
            <div class="code-block-wrapper">
              <div class="code-block-header">
                <span class="language-label">${validLanguage}</span>
                <button class="copy-btn" onclick="window.copyCodeBlock(this)">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                  <span class="copy-text">Copiar</span>
                </button>
              </div>
              <pre><code class="hljs language-${validLanguage}">${highlighted}</code></pre>
            </div>
          `;
        }
      },
      breaks: true,
      gfm: true
    });
    window.markedConfigured = true;
  }


  // Si marked no está cargado por alguna razón, devolver texto plano o un fallback simple
  if (typeof marked === 'undefined') {
    console.warn('Marked.js no está cargado. Usando fallback simple.');
    return text.replace(/\n/g, '<br>');
  }

  // Proteger fórmulas matemáticas antes de procesar el markdown
  // Esto evita que marked interprete los guiones bajos o asteriscos dentro de las fórmulas
  const mathBlocks = [];
  let protectedText = text;

  // Proteger bloques $$...$$
  protectedText = protectedText.replace(/\$\$([\s\S]+?)\$\$/g, (match) => {
    mathBlocks.push(match);
    return `MATH_BLOCK_PLACEHOLDER_${mathBlocks.length - 1}`;
  });

  // Proteger inline $...$
  protectedText = protectedText.replace(/\$([^\$\n]+?)\$/g, (match) => {
    mathBlocks.push(match);
    return `MATH_BLOCK_PLACEHOLDER_${mathBlocks.length - 1}`;
  });

  // Proteger referencias de fuente antes del markdown
  // Formato: [[FUENTE:filename.pdf:"quoted text"]]
  const sourceBlocks = [];
  protectedText = protectedText.replace(/\[\[FUENTE:([^\]]+):"([^"]+)"\]\]/g, (match, fileName, citedText) => {
    sourceBlocks.push({ fileName: fileName.trim(), citedText: citedText.trim() });
    return `SOURCE_REF_PLACEHOLDER_${sourceBlocks.length - 1}`;
  });

  // Proteger citas de búsqueda web [1], [2], etc.
  const webCitations = [];
  protectedText = protectedText.replace(/\[(\d+)\]/g, (match, number) => {
    webCitations.push(number);
    return `WEB_CITATION_PLACEHOLDER_${webCitations.length - 1}`;
  });

  // Parsear markdown
  let html = marked.parse(protectedText);

  // Restaurar fórmulas matemáticas
  html = html.replace(/MATH_BLOCK_PLACEHOLDER_(\d+)/g, (match, index) => {
    return mathBlocks[index];
  });

  // Restaurar referencias de fuente como badges HTML
  html = html.replace(/SOURCE_REF_PLACEHOLDER_(\d+)/g, (match, index) => {
    const ref = sourceBlocks[index];
    if (!ref) return match;

    // Use base64 encoding to safely pass data through HTML attributes
    const fileNameB64 = btoa(unescape(encodeURIComponent(ref.fileName)));
    const citedTextB64 = btoa(unescape(encodeURIComponent(ref.citedText)));
    const displayName = escapeHtml(ref.fileName);

    return `<span class="source-badge" 
                  data-file-b64="${fileNameB64}" 
                  data-text-b64="${citedTextB64}"
                  title="Ver fuente: ${displayName}">
              <span class="source-badge-icon">📄</span>
              <span class="source-badge-name">${displayName}</span>
            </span>`;
  });

  // Restaurar citas de búsqueda web como badges clicables
  html = html.replace(/WEB_CITATION_PLACEHOLDER_(\d+)/g, (match, index) => {
    const citationNumber = webCitations[index];
    if (!citationNumber) return match;

    const sourcesMap = window._webSourcesMap || [];
    const source = sourcesMap.find(s => String(s.id) === String(citationNumber));
    const encodedUrl = encodeURIComponent(source?.url || '');
    const encodedTitle = encodeURIComponent(source?.title || '');

    return `<button class="citation-badge" data-source-id="${citationNumber}" data-source-url="${encodedUrl}" data-source-title="${encodedTitle}" onclick="window.openWebCitation(this.dataset.sourceId, decodeURIComponent(this.dataset.sourceUrl || ''), decodeURIComponent(this.dataset.sourceTitle || ''))" title="Ver fuente ${citationNumber}">[${citationNumber}]</button>`;
  });

  // Agregar clase markdown-table a todas las tablas para que se apliquen los estilos CSS
  html = html.replace(/<table>/g, '<table class="markdown-table">');

  return html;
}

async function copyToClipboard(text, button) {
  try {
    await navigator.clipboard.writeText(text);

    // Feedback visual
    // Si el botón tiene la clase copy-message-btn (mensaje completo), usar el comportamiento original (solo icono)
    if (button.classList.contains('copy-message-btn')) {
      const originalHTML = button.innerHTML;
      button.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
      button.classList.add('copied');

      setTimeout(() => {
        button.innerHTML = originalHTML;
        button.classList.remove('copied');
      }, 1500);
    } else {
      // Comportamiento para botones de código (con texto)
      const originalHTML = button.innerHTML;
      const textSpan = button.querySelector('.copy-text');
      const svg = button.querySelector('svg');

      if (textSpan) textSpan.textContent = 'Copiado!';
      if (svg) svg.innerHTML = '<polyline points="20 6 9 17 4 12"></polyline>'; // Check icon content
      button.classList.add('copied');

      setTimeout(() => {
        button.innerHTML = originalHTML;
        button.classList.remove('copied');
      }, 1500);
    }
  } catch (err) {
    console.error('Error al copiar:', err);
    // Fallback simple
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
      document.execCommand('copy');
      // Reutilizar lógica de feedback visual
      if (button.classList.contains('copy-message-btn')) {
        const originalHTML = button.innerHTML;
        button.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        button.classList.add('copied');
        setTimeout(() => { button.innerHTML = originalHTML; button.classList.remove('copied'); }, 1500);
      } else {
        const originalHTML = button.innerHTML;
        const textSpan = button.querySelector('.copy-text');
        if (textSpan) textSpan.textContent = 'Copiado!';
        button.classList.add('copied');
        setTimeout(() => { button.innerHTML = originalHTML; button.classList.remove('copied'); }, 1500);
      }
    } catch (e) {
      console.error('Fallback copy failed', e);
    }
    document.body.removeChild(textArea);
  }
}

// Función global para copiar bloques de código
window.copyCodeBlock = async function (button) {
  const wrapper = button.closest('.code-block-wrapper');
  if (!wrapper) return;

  const codeElement = wrapper.querySelector('code');
  if (!codeElement) return;

  const text = codeElement.innerText;
  await copyToClipboard(text, button);
};

function getFileExtension(filename) {
  return filename.split('.').pop().toUpperCase();
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function createFileAttachmentElement(file) {
  const fileExt = getFileExtension(file.name);
  const fileSize = formatFileSize(file.size);

  // Si es una imagen, mostrar la miniatura
  if (file.isImage && file.content) {
    return `
      <div class="message-attachment message-attachment-image">
        <img src="${file.content}" alt="${escapeHtml(file.name)}" class="attachment-image-preview" />
        <div class="attachment-info">
          <div class="attachment-name">${escapeHtml(file.name)}</div>
          <div class="attachment-size">${fileSize}</div>
        </div>
      </div>
    `;
  }

  // Para otros archivos, mostrar el icono normal
  return `
    <div class="message-attachment">
      <div class="attachment-icon attachment-${fileExt.toLowerCase()}">
        <span class="attachment-ext">${fileExt}</span>
      </div>
      <div class="attachment-info">
        <div class="attachment-name">${escapeHtml(file.name)}</div>
        <div class="attachment-size">${fileSize}</div>
      </div>
    </div>
  `;
}

function appendMessageElement(message) {
  const li = document.createElement('li');
  li.className = `message ${message.role}`;

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  if (message.role === 'user') {
    avatar.textContent = 'Tú';
  } else {
    const img = document.createElement('img');
    img.src = 'assets/Fondo.png';
    img.alt = 'AI';
    avatar.appendChild(img);
  }

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';

  let content = '';

  // Agregar archivos adjuntos si existen (solo para mensajes del usuario)
  if (message.attachedFiles && message.attachedFiles.length > 0 && message.role === 'user') {
    message.attachedFiles.forEach(file => {
      content += createFileAttachmentElement(file);
    });
  }

  // Agregar bloque de pensamiento si existe
  if (message.thinking && message.role === 'assistant') {
    content += createThinkingBlock(message.thinking, message.thinkingDuration, false);
  }

  // Verificar si es un mensaje de Deep Research en progreso
  // SOLO mostrar la UI de progreso si hay una investigación activa Y este es el mensaje correcto
  const isResearchActive = isDeepResearchInProgress();
  const isCorrectMessage = message.id === deepResearchMessageId;
  const isCorrectConversation = state.activeId === deepResearchActiveConversationId;
  const hasNoFinalContent = !message.content || message.content === '';

  const isActiveDeepResearch = message.role === 'assistant' &&
    message.isDeepResearchInProgress === true &&
    hasNoFinalContent &&
    isResearchActive &&
    isCorrectMessage &&
    isCorrectConversation;

  // Variable para almacenar datos de viaje parseados (accesible en todo el scope de la función)
  let travelDataForRendering = null;

  // Si el mensaje tiene el flag pero ya tiene contenido, limpiar el flag (investigación terminada)
  if (message.isDeepResearchInProgress && message.content && message.deepResearch) {
    message.isDeepResearchInProgress = false;
    persistState();
  }

  // Agregar el contenido del mensaje
  if (isActiveDeepResearch) {
    // Es el mensaje de Deep Research activo, crear contenedor de progreso
    bubble.innerHTML = '';
    const progressContainer = createDeepResearchProgressElement();
    bubble.appendChild(progressContainer);

    // Actualizar con el estado actual
    if (deepResearchProgressState) {
      updateDeepResearchProgress(
        progressContainer,
        deepResearchProgressState.progress,
        deepResearchProgressState.status
      );
    }

    // Guardar referencia al nuevo contenedor
    deepResearchCurrentContainer = progressContainer;

    // Restaurar los pasos completados si hay datos
    if (deepResearchStepsData && deepResearchStepsData.length > 0) {
      deepResearchStepsData.forEach((step) => {
        addResearchStep(progressContainer, step, step.isActive, step.isCompleted);
      });
    }

    // Restaurar hallazgos
    if (deepResearchFindingsData && deepResearchFindingsData.length > 0) {
      deepResearchFindingsData.forEach(finding => {
        addFinding(progressContainer, finding);
      });
    }
  } else if (message.role === 'assistant' && message.deepResearch && message.content) {
    // Es un mensaje de Deep Think completado - mostrar con encabezado especial
    content += `
      <div class="deep-research-report">
        <div class="deep-research-report-header">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2C7.58 2 4 5.58 4 10c0 2.5 1.2 4.7 3 6.2V19c0 1.1.9 2 2 2h6c1.1 0 2-.9 2-2v-2.8c1.8-1.5 3-3.7 3-6.2 0-4.42-3.58-8-8-8z" fill="none"/>
            <path d="M9 13v2M12 11v4M15 13v2" stroke-linecap="round"/>
          </svg>
          Pensamiento profundo • ${message.deepResearch.findings || 0} temas analizados
        </div>
      </div>
    `;
    content += parseMarkdown(message.content);
  } else if (message.role === 'assistant' && message.webResearchData && message.webResearchData.pdfGenerated && message.content) {
    // Es un mensaje de investigación web con PDF completado - mostrar con botón de PDF
    const webData = message.webResearchData;
    content += `
      <div class="deep-research-report">
        <div class="deep-research-report-header">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
          Investigación web profunda • ${webData.findings?.length || 0} temas • ${webData.sources?.length || 0} fuentes
        </div>
      </div>
    `;
    content += parseMarkdown(message.content);
    content += `
      <button class="generate-report-btn" onclick="event.stopPropagation(); regenerateAndShowPDF('${message.id}')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
        </svg>
        Ver informe PDF completo
      </button>
    `;
  } else if (message.role === 'assistant' && message.webSearchData && message.content) {
    // Es un mensaje de búsqueda web normal completado - reconstruir la UI
    const webData = message.webSearchData;
    content += createWebSearchUIForRestore(webData);
    content += '<div style="height: 1px; background: rgba(255,255,255,0.1); margin: 16px 0;"></div>';
    content += '<div class="web-search-response">';
    content += createWebThinkingBlock(message.content.substring(0, 100), false);
    content += '<div class="web-response-content">' + parseMarkdown(message.content) + '</div>';
    content += '</div>';
  } else if (message.content) {
    // Comprobar si hay un canvas asociado a esta conversación
    const conversation = state.conversations[state.activeId];
    const canvasDoc = conversation ? getCanvasDoc(conversation.id) : null;
    const scoreDoc = conversation ? getScoreDoc(conversation.id) : null;

    // Si hay canvas y el mensaje tiene indicadores de canvas creado
    if (canvasDoc && message.role === 'assistant' && message.canvasId === canvasDoc.id) {
      // Dividir el contenido en texto antes del canvas, tarjeta canvas, y texto después
      const parts = message.content.split('[CANVAS_ARTIFACT]');

      // Usar la versión del mensaje si existe, sino la actual del documento
      const messageVersion = message.canvasVersion || canvasDoc.version || 1;

      if (parts.length > 1) {
        // Hay marcador de artifact
        if (parts[0]) {
          content += parseMarkdown(parts[0]);
        }

        // Insertar tarjeta de artifact con versión
        content += createArtifactCard({
          title: canvasDoc.title,
          content: canvasDoc.content,
          canvasId: canvasDoc.id,
          version: messageVersion
        });

        if (parts[1]) {
          content += parseMarkdown(parts[1]);
        }
      } else {
        // No hay marcador pero hay canvas, agregar al final
        content += parseMarkdown(message.content);
        content += createArtifactCard({
          title: canvasDoc.title,
          content: canvasDoc.content,
          canvasId: canvasDoc.id,
          version: messageVersion
        });
      }
    } else if (scoreDoc && message.role === 'assistant' && message.scoreId === scoreDoc.id) {
      // Si hay partitura y el mensaje la referencia
      const parts = message.content.split('[SCORE_ARTIFACT]');
      const messageVersion = message.scoreVersion || scoreDoc.version || 1;

      if (parts.length > 1) {
        // Hay marcador de artifact
        if (parts[0]) {
          content += parseMarkdown(parts[0]);
        }

        // Insertar tarjeta de partitura con versión
        content += createScoreArtifactCard({
          title: scoreDoc.title,
          scoreId: scoreDoc.id,
          version: messageVersion,
          meter: scoreDoc.meter,
          key: scoreDoc.key,
          tempo: scoreDoc.tempo
        });

        if (parts[1]) {
          content += parseMarkdown(parts[1]);
        }
      } else {
        // No hay marcador pero hay partitura, agregar al final
        content += parseMarkdown(message.content);
        content += createScoreArtifactCard({
          title: scoreDoc.title,
          scoreId: scoreDoc.id,
          version: messageVersion,
          meter: scoreDoc.meter,
          key: scoreDoc.key,
          tempo: scoreDoc.tempo
        });
      }
    } else {
      // Si es un mensaje del usuario con investigación web, añadir badge
      if (message.role === 'user' && message.isWebResearch) {
        content += `
          <div class="web-research-badge">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="10" cy="10" r="6" />
              <path d="M14.5 14.5L20 20" stroke-linecap="round" />
              <circle cx="12" cy="12" r="10" opacity="0.3"/>
              <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" opacity="0.3"/>
            </svg>
            <span>Investigación Web Profunda</span>
          </div>
        `;
      }

      // Verificar si hay comandos de viaje para limpiar ANTES del parseMarkdown
      let messageContentToRender = message.content;
      let travelDataForLater = null;

      if (message.role === 'assistant' && message.content) {
        const hasTravelContent = message.content.includes('[TRAVEL_MAP]') ||
          message.content.includes('[PLACE:');

        if (hasTravelContent && window.travelMode?.parseCommands) {
          // Parsear y limpiar los comandos de viaje
          travelDataForLater = window.travelMode.parseCommands(message.content);
          // Usar el texto limpio sin los comandos
          messageContentToRender = travelDataForLater.text || '';
        }

        // Limpiar tags de salud antes de parsear markdown
        if (window.healthMode?.hasContent && window.healthMode.hasContent(messageContentToRender)) {
          messageContentToRender = window.healthMode.cleanTags(messageContentToRender);
        }
      }

      // Ahora parsear el markdown con el contenido limpio
      const parsedContent = parseMarkdown(messageContentToRender);
      content += parsedContent;

      // Guardar la data de viaje para renderizar después
      if (travelDataForLater) {
        travelDataForRendering = travelDataForLater;
      }
    }
  }

  // Crear contenedor para botón de copiar y hora
  const copyContainer = document.createElement('div');
  copyContainer.className = 'copy-message-container';

  // Crear botón de copiar pequeño
  const copyButton = document.createElement('button');
  copyButton.className = 'copy-message-btn';
  copyButton.title = 'Copiar mensaje';
  copyButton.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
  copyButton.addEventListener('click', async (e) => {
    e.stopPropagation();
    // Obtener el texto plano del mensaje (sin HTML)
    const textToCopy = message.content || '';
    await copyToClipboard(textToCopy, copyButton);
  });

  // Crear botón de regenerar respuesta (solo para mensajes del asistente)
  let webSourcesBtn = null;
  let webSourcesPopup = null;

  if (message.role === 'assistant') {
    const regenerateButton = document.createElement('button');
    regenerateButton.className = 'regenerate-message-btn';
    regenerateButton.title = 'Regenerar respuesta';
    regenerateButton.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4v6h6"></path><path d="M23 20v-6h-6"></path><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"></path></svg>';
    regenerateButton.addEventListener('click', async (e) => {
      e.stopPropagation();
      await regenerateResponse(message.id);
    });
    copyContainer.appendChild(regenerateButton);

    // Preparar botón de fuentes web si el mensaje tiene webSearchData (se añade después del copiar)
    if (message.webSearchData && message.webSearchData.results && message.webSearchData.results.length > 0) {
      webSourcesBtn = document.createElement('button');
      webSourcesBtn.className = 'web-sources-btn';
      webSourcesBtn.title = 'Ver fuentes consultadas';
      webSourcesBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
        </svg>
        <span>${message.webSearchData.results.length}</span>
      `;

      // Crear popup de fuentes
      webSourcesPopup = document.createElement('div');
      webSourcesPopup.className = 'web-sources-popup';
      webSourcesPopup.style.display = 'none';

      let popupContent = '<div class="web-sources-popup-header"><span>Fuentes consultadas</span></div>';
      popupContent += '<div class="web-sources-popup-list">';

      message.webSearchData.results.forEach(result => {
        let domain = '';
        let faviconUrl = '';
        try {
          const urlObj = new URL(result.link);
          domain = urlObj.hostname.replace('www.', '');
          faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
        } catch (e) {
          domain = 'web';
        }

        popupContent += `
          <a href="${result.link}" target="_blank" rel="noopener noreferrer" class="web-sources-popup-item">
            <img src="${faviconUrl}" alt="" class="web-sources-popup-favicon" onerror="this.style.display='none'">
            <div class="web-sources-popup-info">
              <div class="web-sources-popup-title">${escapeHtml(result.title)}</div>
              <div class="web-sources-popup-url">${domain}</div>
            </div>
          </a>
        `;
      });

      popupContent += '</div>';
      webSourcesPopup.innerHTML = popupContent;

      webSourcesBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isVisible = webSourcesPopup.style.display === 'block';
        webSourcesPopup.style.display = isVisible ? 'none' : 'block';
      });
    }
  }

  // Crear botón de editar (solo para mensajes del usuario)
  if (message.role === 'user') {
    const editButton = document.createElement('button');
    editButton.className = 'edit-message-btn';
    editButton.title = 'Editar mensaje';
    editButton.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';
    editButton.addEventListener('click', async (e) => {
      e.stopPropagation();
      openEditMessageModal(message.id);
    });
    copyContainer.insertBefore(editButton, copyContainer.firstChild);
  }

  // Crear elemento para la hora
  const timeElement = document.createElement('span');
  timeElement.className = 'message-time';
  const messageTime = message.timestamp || message.createdAt || Date.now();
  timeElement.textContent = formatTime(messageTime);

  copyContainer.appendChild(copyButton);

  // Añadir botón de fuentes web después del copiar (si existe)
  if (webSourcesBtn) {
    copyContainer.appendChild(webSourcesBtn);
    copyContainer.appendChild(webSourcesPopup);
  }

  // Añadir indicador de modelo antes de la hora (solo para mensajes del asistente)
  if (message.role === 'assistant' && message.model) {
    const modelIndicator = document.createElement('span');
    modelIndicator.className = 'message-model-indicator';
    
    // Mostrar modelo y tokens/segundo si está disponible
    let displayText = message.model;
    if (message.tokensPerSecond && message.tokensPerSecond > 0) {
      displayText += ` • ${message.tokensPerSecond} t/s`;
    }
    
    modelIndicator.textContent = displayText;
    modelIndicator.title = `Respondido por ${message.model}${message.tokensPerSecond ? ` (${message.tokensPerSecond} tokens/segundo)` : ''}`;
    copyContainer.appendChild(modelIndicator);
  }

  copyContainer.appendChild(timeElement);

  // Agregar contenido y luego el contenedor de copiar dentro del bubble
  // Solo agregar contenido HTML si NO es un Deep Research activo (ya tiene el progressContainer)
  if (!isActiveDeepResearch) {
    bubble.innerHTML = content;
  }

  bubble.appendChild(copyContainer);

  // Renderizar matemáticas con KaTeX
  if (typeof renderMathInElement !== 'undefined') {
    renderMathInElement(bubble, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '$', right: '$', display: false }
      ],
      throwOnError: false
    });
  }

  // Renderizar mapas de viajes
  if (message.role === 'assistant' && window.travelMode?.renderComponents) {
    let travelData = null;

    // PRIMERO: Verificar si hay travelPlaces guardado (desde localStorage)
    if (message.travelPlaces && message.travelPlaces.length > 0) {
      console.log('🗺️ Usando travelPlaces guardado:', message.travelPlaces.length, 'lugares');
      travelData = {
        hasTravel: true,
        places: message.travelPlaces,
        showMap: true
      };
    }
    // SEGUNDO: Si no hay data guardada pero hay comandos en el contenido, parsear
    else if (message.content) {
      const hasTravelContent = message.content.includes('[TRAVEL_MAP]') ||
        message.content.includes('[PLACE:');

      if (hasTravelContent && window.travelMode?.parseCommands) {
        travelData = window.travelMode.parseCommands(message.content);

        // Usar el texto limpio de parseTravelCommands para actualizar el bubble
        if (travelData.text !== message.content) {
          // Solo actualizar si el texto cambió (tiene comandos para limpiar)
          bubble.innerHTML = travelData.text.replace(/\n/g, '<br>');
        }
      }
    }

    // Renderizar el mapa si hay data
    if (travelData && travelData.hasTravel && travelData.places && travelData.places.length > 0) {
      setTimeout(() => {
        window.travelMode.renderComponents(bubble, travelData);
      }, 300);
    }
  }

  // Renderizar componentes de salud
  if (message.role === 'assistant' && message.content && window.healthMode?.hasContent && window.healthMode.hasContent(message.content)) {
    const healthData = window.healthMode.parseCommands(message.content);
    if (healthData) {
      setTimeout(() => {
        window.healthMode.renderComponents(bubble, healthData);
      }, 300);
    }
  }

  li.append(avatar, bubble);
  chatList?.appendChild(li);
  scrollChatToBottom();
  return { li, bubble };
}

function renderActiveConversation() {
  if (!chatList) return;
  const conversation = state.conversations[state.activeId];
  if (!conversation) {
    showEmptyState();
    return;
  }

  chatList.innerHTML = '';
  if (conversation.messages.length === 0) {
    showEmptyState();
  } else {
    showChatState();
    conversation.messages.forEach((message) => appendMessageElement(message));
  }

  // Mostrar canvas si existe
  const hasCanvasDoc = !!getCanvasDoc(conversation.id);
  if (hasCanvasDoc) {
    renderCanvasPanel(conversation.id);
  } else {
    toggleCanvasVisibility(false);
  }

  // Traducir títulos predeterminados dinámicamente según el idioma actual
  const currentTitle = conversation.title;
  const isDefault = !currentTitle ||
    currentTitle === 'Nueva conversación' ||
    currentTitle === 'New Conversation' ||
    currentTitle === DEFAULT_TITLE;

  const defaultTitle = window.translationManager ? window.translationManager.translate('chat.newConversation') : DEFAULT_TITLE;
  conversationTitle.textContent = isDefault ? defaultTitle : currentTitle;

  updateAttachmentsBadge(); // Actualizar badge al cambiar de conversación
}

function showEmptyState() {
  if (emptyState) emptyState.style.display = 'flex';
  if (chatState) chatState.style.display = 'none';
  // Mostrar botones del empty-state y ocultar los del chat
  if (incognitoButtonEmpty) incognitoButtonEmpty.style.display = 'flex';
  if (incognitoButton) incognitoButton.style.display = 'none';
  // Mostrar botón overlay del empty-state
  const screenOverlayToggleEmpty = document.getElementById('screen-overlay-toggle-empty');
  if (screenOverlayToggleEmpty) screenOverlayToggleEmpty.style.display = 'flex';

  // Show empty state header (contains language selector)
  const emptyStateHeader = document.getElementById('empty-state-header');
  if (emptyStateHeader) emptyStateHeader.style.display = 'flex';
}

function showChatState() {
  if (emptyState) emptyState.style.display = 'none';
  if (chatState) chatState.style.display = 'flex';
  // Ocultar botones del empty-state y mostrar los del chat
  if (incognitoButtonEmpty) incognitoButtonEmpty.style.display = 'none';
  if (incognitoButton) incognitoButton.style.display = 'flex';
  // Ocultar botón overlay del empty-state (ya hay uno en el chat header)
  const screenOverlayToggleEmpty = document.getElementById('screen-overlay-toggle-empty');
  if (screenOverlayToggleEmpty) screenOverlayToggleEmpty.style.display = 'none';

  // Hide empty state header (contains language selector)
  const emptyStateHeader = document.getElementById('empty-state-header');
  if (emptyStateHeader) emptyStateHeader.style.display = 'none';
}

function renderConversationList() {
  if (!conversationList) return;
  conversationList.innerHTML = '';

  // Filtrar conversaciones que pertenecen a un proyecto (estas se mostrarán solo en la vista del proyecto)
  const filteredOrder = state.order.filter(id => {
    const conversation = state.conversations[id];
    // Excluir conversaciones que pertenecen a un proyecto
    return conversation && !conversation.projectId;
  });

  if (filteredOrder.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'conversation-item';
    empty.textContent = 'No hay conversaciones todavía';
    conversationList.appendChild(empty);
    return;
  }

  filteredOrder.forEach((id) => {
    const conversation = state.conversations[id];
    if (!conversation) return;

    const item = document.createElement('li');
    item.className = `conversation-item${id === state.activeId ? ' active' : ''}`;

    const textBlock = document.createElement('div');
    textBlock.className = 'conversation-text';

    const name = document.createElement('p');
    name.className = 'conversation-name';

    const titleText = document.createElement('span');
    titleText.className = 'conversation-title-text';

    // Check if title is a default title in any language to allow translation
    const currentTitle = conversation.title;
    const isDefault = !currentTitle ||
      currentTitle === 'Nueva conversación' ||
      currentTitle === 'New Conversation' ||
      currentTitle === DEFAULT_TITLE;

    const defaultTitle = window.translationManager ? window.translationManager.translate('chat.newConversation') : DEFAULT_TITLE;
    titleText.textContent = isDefault ? defaultTitle : currentTitle;
    name.appendChild(titleText);

    const preview = document.createElement('p');
    preview.className = 'conversation-preview';
    const lastMessage = conversation.messages[conversation.messages.length - 1];
    preview.textContent = lastMessage
      ? (lastMessage.content.slice(0, 60) + (lastMessage.content.length > 60 ? '...' : ''))
      : (window.translationManager ? window.translationManager.translate('empty.noMessages') : 'Sin mensajes aún');

    textBlock.append(name, preview);
    item.appendChild(textBlock);

    const actions = document.createElement('div');
    actions.className = 'conversation-actions';

    const renameBtn = document.createElement('button');
    renameBtn.className = 'icon-button small';
    renameBtn.type = 'button';
    renameBtn.title = 'Renombrar conversación';
    renameBtn.textContent = '✎';

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'icon-button small';
    deleteBtn.type = 'button';
    deleteBtn.title = 'Eliminar conversación';
    deleteBtn.textContent = '🗑';

    renameBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      handleRenameConversation(id);
    });
    deleteBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      handleDeleteConversation(id);
    });

    actions.append(renameBtn, deleteBtn);
    item.append(actions);

    item.addEventListener('click', () => setActiveConversation(id));

    conversationList.appendChild(item);
  });
}

function setActiveConversation(id) {
  if (!state.conversations[id]) return;

  // NO cancelar Deep Research - permitir cambiar de chat para ver otras conversaciones
  // Solo bloquear la escritura en otros chats (se maneja en lockInputsDuringResearch)

  state.activeId = id;
  if (!attachedFiles[id]) {
    attachedFiles[id] = [];
  }

  // Mostrar/ocultar banner de investigación en progreso
  updateResearchBanner(id);

  // Activar el proyecto asociado a la conversación (si tiene)
  const conversation = state.conversations[id];
  if (conversation.projectId && projectsState?.projects[conversation.projectId]) {
    // La conversación pertenece a un proyecto
    projectsState.activeProjectId = conversation.projectId;
    saveActiveProject(conversation.projectId);
    updateProjectBadge();
    renderProjectsList();

    const chatState = document.getElementById('chat-state');
    if (chatState) chatState.classList.add('in-project');
  } else {
    // Conversación normal, sin proyecto
    if (projectsState) {
      projectsState.activeProjectId = null;
      saveActiveProject(null);
      updateProjectBadge();
      renderProjectsList();
    }

    const chatState = document.getElementById('chat-state');
    if (chatState) chatState.classList.remove('in-project');
  }

  renderConversationList();
  renderActiveConversation();
  renderAttachedFiles();
  renderCanvasPanel(id);
  const doc = getCanvasDoc(id);
  toggleCanvasVisibility(!!doc || canvasMode);

  // Gestionar canvas de partituras - mostrar si está en modo música O si hay partitura
  const scoreDoc = getScoreDoc(id);
  if (scoreDoc && (musicMode || window._musicModeActive)) {
    renderScoreCanvasPanel(id);
  } else {
    toggleScoreCanvasPanel(false);
  }

  persistState();
}

function createConversation() {
  // Cerrar el panel de proyectos si está abierto
  const projectsPanel = document.getElementById('projects-panel');
  if (projectsPanel && projectsPanel.style.display === 'flex') {
    projectsPanelVisible = false;
    projectsPanel.style.display = 'none';
    const btn = document.getElementById('projects-panel-btn');
    if (btn) btn.classList.remove('active');
  }

  const id = generateId('conv');
  const conversation = {
    id,
    title: DEFAULT_TITLE,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
    projectId: null, // Conversación sin proyecto
  };
  state.conversations[id] = conversation;
  attachedFiles[id] = []; // Inicializar array de archivos para esta conversación
  touchConversation(id);
  setActiveConversation(id); // Esto desactivará el proyecto automáticamente
  if (promptInput) promptInput.focus();
}

// Variables para almacenar el ID de la conversación a modificar
let conversationToRename = null;
let conversationToDelete = null;

function handleRenameConversation(id) {
  const conversation = state.conversations[id];
  if (!conversation) return;

  conversationToRename = id;
  const modal = document.getElementById('rename-conversation-modal');
  const input = document.getElementById('rename-conversation-input');

  if (modal && input) {
    input.value = conversation.title ?? DEFAULT_TITLE;
    modal.style.display = 'flex';

    // Animar la entrada del modal
    const content = modal.querySelector('.modal-content');
    if (content) {
      content.style.animation = 'none';
      content.offsetHeight; // Forzar reflow
      content.style.animation = 'slideDown 0.3s ease';
    }

    setTimeout(() => {
      input.focus();
      input.select();
    }, 100);
  }
}

function confirmRenameConversation() {
  if (!conversationToRename) return;

  const conversation = state.conversations[conversationToRename];
  const input = document.getElementById('rename-conversation-input');

  if (!conversation || !input) return;

  const newTitle = input.value.trim();
  if (!newTitle) return;

  conversation.title = newTitle || DEFAULT_TITLE;
  touchConversation(conversationToRename);

  // Añadir animación de highlight al elemento renombrado
  const conversationItem = document.querySelector(`.conversation-item.active`);
  if (conversationItem) {
    conversationItem.classList.add('renaming');
    setTimeout(() => conversationItem.classList.remove('renaming'), 500);
  }

  renderConversationList();
  if (conversationToRename === state.activeId) renderActiveConversation();
  persistState();

  closeRenameModal();
}

function closeRenameModal() {
  const modal = document.getElementById('rename-conversation-modal');
  if (modal) {
    const content = modal.querySelector('.modal-content');
    if (content) {
      content.style.animation = 'slideUp 0.2s ease reverse';
      setTimeout(() => {
        modal.style.display = 'none';
        content.style.animation = '';
      }, 200);
    } else {
      modal.style.display = 'none';
    }
  }
  conversationToRename = null;
}

function handleDeleteConversation(id) {
  if (!state.conversations[id]) return;

  conversationToDelete = id;
  const modal = document.getElementById('delete-conversation-modal');
  const nameElement = document.getElementById('delete-conversation-name');
  const conversation = state.conversations[id];

  if (modal && nameElement) {
    nameElement.textContent = conversation.title ?? DEFAULT_TITLE;
    modal.style.display = 'flex';

    // Animar la entrada del modal
    const content = modal.querySelector('.modal-content');
    if (content) {
      content.style.animation = 'none';
      content.offsetHeight;
      content.style.animation = 'slideDown 0.3s ease';
    }
  }
}

function confirmDeleteConversation() {
  if (!conversationToDelete) return;

  // Encontrar el elemento de la conversación y animarlo
  const conversationItems = document.querySelectorAll('.conversation-item');
  const index = state.order.indexOf(conversationToDelete);

  if (conversationItems[index]) {
    conversationItems[index].classList.add('deleting');

    // Esperar a que termine la animación antes de eliminar
    setTimeout(() => {
      delete state.conversations[conversationToDelete];
      state.order = state.order.filter((convId) => convId !== conversationToDelete);

      if (state.activeId === conversationToDelete) {
        state.activeId = state.order[0] ?? null;
      }

      if (!state.activeId) {
        createConversation();
      } else {
        renderConversationList();
        renderActiveConversation();
        persistState();
      }

      conversationToDelete = null;
    }, 300);
  } else {
    // Si no se encuentra el elemento, eliminar directamente
    delete state.conversations[conversationToDelete];
    state.order = state.order.filter((convId) => convId !== conversationToDelete);

    if (state.activeId === conversationToDelete) {
      state.activeId = state.order[0] ?? null;
    }

    if (!state.activeId) {
      createConversation();
    } else {
      renderConversationList();
      renderActiveConversation();
      persistState();
    }

    conversationToDelete = null;
  }

  closeDeleteConversationModal();
}

function closeDeleteConversationModal() {
  const modal = document.getElementById('delete-conversation-modal');
  if (modal) {
    const content = modal.querySelector('.modal-content');
    if (content) {
      content.style.animation = 'slideUp 0.2s ease reverse';
      setTimeout(() => {
        modal.style.display = 'none';
        content.style.animation = '';
      }, 200);
    } else {
      modal.style.display = 'none';
    }
  }
}

function handleDeleteAllConversations() {
  if (state.order.length === 0) return;

  const modal = document.getElementById('delete-all-conversations-modal');
  if (modal) {
    modal.style.display = 'flex';

    // Animar la entrada del modal
    const content = modal.querySelector('.modal-content');
    if (content) {
      content.style.animation = 'none';
      content.offsetHeight;
      content.style.animation = 'slideDown 0.3s ease';
    }
  }
}

function confirmDeleteAllConversations() {
  // Animar todos los elementos saliendo
  const conversationItems = document.querySelectorAll('.conversation-item');
  conversationItems.forEach((item, index) => {
    setTimeout(() => {
      item.classList.add('deleting');
    }, index * 50); // Escalonar la animación
  });

  // Esperar a que terminen todas las animaciones
  const totalAnimationTime = (conversationItems.length * 50) + 300;

  setTimeout(() => {
    // Limpiar estado
    state.conversations = {};
    state.order = [];
    state.activeId = null;

    // Crear nueva conversación
    createConversation();
    persistState();
  }, totalAnimationTime);

  closeDeleteAllModal();
}

function closeDeleteAllModal() {
  const modal = document.getElementById('delete-all-conversations-modal');
  if (modal) {
    const content = modal.querySelector('.modal-content');
    if (content) {
      content.style.animation = 'slideUp 0.2s ease reverse';
      setTimeout(() => {
        modal.style.display = 'none';
        content.style.animation = '';
      }, 200);
    } else {
      modal.style.display = 'none';
    }
  }
}

function handleRenameActive() {
  if (!state.activeId) return;
  handleRenameConversation(state.activeId);
}

function handleDeleteActive() {
  if (!state.activeId) return;
  handleDeleteConversation(state.activeId);
}

function createThinkingBlock(thinking, duration = null, isLoading = false) {
  const durationText = duration ? `${duration} segundos` : '';

  if (isLoading) {
    if (thinking) {
      return `
        <div class="thinking-block expanded thinking-streaming">
          <div class="thinking-header">
            <span class="thinking-icon">
              <svg viewBox="0 0 40 28" fill="none" xmlns="http://www.w3.org/2000/svg">
                <!-- Cola izquierda superior -->
                <rect class="fish-tail" x="0" y="4" width="8" height="6" fill="var(--theme-primary)" opacity="0.6"/>
                <!-- Cola izquierda inferior -->
                <rect class="fish-tail" x="0" y="18" width="8" height="6" fill="var(--theme-primary)" opacity="0.6"/>
                <!-- Conexión cola-cuerpo -->
                <rect class="fish-body" x="8" y="11" width="8" height="6" fill="var(--theme-primary)" opacity="0.5"/>
                <!-- Cuerpo superior -->
                <rect class="fish-body" x="16" y="4" width="16" height="6" fill="var(--theme-primary)" opacity="0.5"/>
                <!-- Cuerpo inferior -->
                <rect class="fish-body" x="16" y="18" width="16" height="6" fill="var(--theme-primary)" opacity="0.5"/>
                <!-- Cabeza/final derecho -->
                <rect class="fish-body" x="32" y="11" width="8" height="6" fill="var(--theme-primary)" opacity="0.5"/>
              </svg>
            </span>
            <span class="thinking-title thinking-active">Pensando<span class="thinking-dots-animated"><span class="dot">.</span><span class="dot">.</span><span class="dot">.</span></span></span>
          </div>
          <div class="thinking-content thinking-content-streaming" style="max-height: 120px; opacity: 1;">
            <div class="thinking-text">${escapeHtml(thinking)}<span class="thinking-cursor">▊</span></div>
          </div>
        </div>
      `;
    }

    return `
      <div class="thinking-block">
        <div class="thinking-header">
          <span class="thinking-icon">
            <svg viewBox="0 0 40 28" fill="none" xmlns="http://www.w3.org/2000/svg">
              <!-- Cola izquierda superior -->
              <rect class="fish-tail" x="0" y="4" width="8" height="6" fill="var(--theme-primary)" opacity="0.6"/>
              <!-- Cola izquierda inferior -->
              <rect class="fish-tail" x="0" y="18" width="8" height="6" fill="var(--theme-primary)" opacity="0.6"/>
              <!-- Conexión cola-cuerpo -->
              <rect class="fish-body" x="8" y="11" width="8" height="6" fill="var(--theme-primary)" opacity="0.5"/>
              <!-- Cuerpo superior -->
              <rect class="fish-body" x="16" y="4" width="16" height="6" fill="var(--theme-primary)" opacity="0.5"/>
              <!-- Cuerpo inferior -->
              <rect class="fish-body" x="16" y="18" width="16" height="6" fill="var(--theme-primary)" opacity="0.5"/>
              <!-- Cabeza/final derecho -->
              <rect class="fish-body" x="32" y="11" width="8" height="6" fill="var(--theme-primary)" opacity="0.5"/>
            </svg>
          </span>
          <span class="thinking-title thinking-active">Pensando</span>
        </div>
      </div>
    `;
  }

  // El bloque siempre empieza cerrado, el usuario debe hacer clic para expandirlo
  return `
    <div class="thinking-block" onclick="this.classList.toggle('expanded')">
      <div class="thinking-header">
        <span class="thinking-icon">⚛</span>
        <span class="thinking-title">Pensó durante ${durationText || '...'}</span>
        <span class="thinking-chevron">▼</span>
      </div>
      <div class="thinking-content">
        <div class="thinking-text">${escapeHtml(thinking || '')}</div>
      </div>
    </div>
  `;
}

// Variable para rastrear si necesitamos scroll
let lastScrollTime = 0;
const SCROLL_INTERVAL = 100; // Scroll máximo cada 100ms

function updateAssistantBubble(bubble, text, thinkingData = null, skipScroll = false) {
  if (!bubble) return;

  let content = '';

  // Agregar bloque de pensamiento si existe
  if (thinkingData) {
    if (thinkingData.isLoading) {
      content += createThinkingBlock(thinkingData.thinking, thinkingData.duration, true);
    } else if (thinkingData.thinking) {
      content += createThinkingBlock(thinkingData.thinking, thinkingData.duration, false);
    }
  }

  // Agregar el texto de la respuesta
  if (text) {
    // Limpiar comandos de viaje del texto visible (se procesan por separado al finalizar)
    let visibleText = text;
    if (visibleText.includes('[TRAVEL_MAP]') || visibleText.includes('[PLACE:')) {
      // Eliminar bloques TRAVEL_MAP completos con todo su contenido
      visibleText = visibleText.replace(/\[TRAVEL_MAP\][\s\S]*?\[\/TRAVEL_MAP\]/g, '');
      // Si el bloque aún no se cerró (streaming en curso), ocultar desde [TRAVEL_MAP] en adelante
      visibleText = visibleText.replace(/\[TRAVEL_MAP\][\s\S]*/g, '');
      // Eliminar PLACE tags sueltos
      visibleText = visibleText.replace(/\[PLACE:[^\]]*\]?/g, '');
      // Eliminar GMAPS_ROUTE
      visibleText = visibleText.replace(/\[GMAPS_ROUTE\]/g, '');
      // Limpiar saltos de línea excesivos
      visibleText = visibleText.replace(/\n{3,}/g, '\n\n').trim();
    }

    // Limpiar comandos de salud del texto visible (se procesan por separado al finalizar)
    if (/\[(?:HEALTH_(?:RECIPE|ROUTINE|PLAN|WELLNESS|SUGGESTIONS)\]|RECIPE_|ROUTINE_|PLAN_|WELLNESS_|SUGGESTION:)\w*/.test(visibleText)) {
      // Eliminar bloques completos cerrados
      visibleText = visibleText.replace(/\[HEALTH_SUGGESTIONS\][\s\S]*?\[\/HEALTH_SUGGESTIONS\]/g, '');
      visibleText = visibleText.replace(/\[HEALTH_RECIPE\][\s\S]*?\[\/HEALTH_RECIPE\]/g, '');
      visibleText = visibleText.replace(/\[HEALTH_ROUTINE\][\s\S]*?\[\/HEALTH_ROUTINE\]/g, '');
      visibleText = visibleText.replace(/\[HEALTH_PLAN\][\s\S]*?\[\/HEALTH_PLAN\]/g, '');
      visibleText = visibleText.replace(/\[HEALTH_WELLNESS\][\s\S]*?\[\/HEALTH_WELLNESS\]/g, '');
      // Si el bloque aún no se cerró (streaming en curso), ocultar desde el tag de apertura en adelante
      visibleText = visibleText.replace(/\[HEALTH_SUGGESTIONS\][\s\S]*/g, '');
      visibleText = visibleText.replace(/\[HEALTH_RECIPE\][\s\S]*/g, '');
      visibleText = visibleText.replace(/\[HEALTH_ROUTINE\][\s\S]*/g, '');
      visibleText = visibleText.replace(/\[HEALTH_PLAN\][\s\S]*/g, '');
      visibleText = visibleText.replace(/\[HEALTH_WELLNESS\][\s\S]*/g, '');
      // Eliminar tags envolventes sueltos
      visibleText = visibleText.replace(/\[\/?HEALTH_[A-Z]+\]/g, '');
      // Eliminar tags de sugerencia
      visibleText = visibleText.replace(/\[SUGGESTION:[^\]]*\]/g, '');
      // Eliminar tags individuales con contenido dentro de brackets: [TAG:contenido]
      visibleText = visibleText.replace(/\[RECIPE_[A-Z_]+:[^\]]*\]/g, '');
      visibleText = visibleText.replace(/\[ROUTINE_[A-Z_]+:[^\]]*\]/g, '');
      visibleText = visibleText.replace(/\[PLAN_[A-Z_]+:[^\]]*\]/g, '');
      visibleText = visibleText.replace(/\[WELLNESS_[A-Z_]+:[^\]]*\]/g, '');
      // Eliminar tags formato B: [RECIPE_STEP:N]texto
      visibleText = visibleText.replace(/\[RECIPE_STEP:\d+\][^\[\n]*/g, '');
      visibleText = visibleText.replace(/\[WELLNESS_STEP:\d+\][^\[\n]*/g, '');
      // Eliminar RECIPE_TIP sin brackets
      visibleText = visibleText.replace(/^\s*RECIPE_TIP:.*$/gm, '');
      // Limpiar líneas vacías de listas
      visibleText = visibleText.replace(/^\s*[-*◦]\s*$/gm, '');
      // Limpiar saltos de línea excesivos
      visibleText = visibleText.replace(/\n{3,}/g, '\n\n').trim();
    }

    content += parseMarkdown(visibleText);
  }

  // Usar requestAnimationFrame para actualizar el DOM de forma más eficiente
  requestAnimationFrame(() => {
    bubble.innerHTML = content;

    // Renderizar matemáticas con KaTeX solo si hay contenido
    if (content && typeof renderMathInElement !== 'undefined') {
      // Usar setTimeout para no bloquear el frame principal
      setTimeout(() => {
        renderMathInElement(bubble, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$', right: '$', display: false }
          ],
          throwOnError: false
        });
      }, 0);
    }

    // Asegurar que el botón de copiar existe dentro del bubble
    let copyContainer = bubble.querySelector('.copy-message-container');
    if (!copyContainer) {
      copyContainer = document.createElement('div');
      copyContainer.className = 'copy-message-container';

      // Crear botón de regenerar
      const regenerateButton = document.createElement('button');
      regenerateButton.className = 'regenerate-message-btn';
      regenerateButton.title = 'Regenerar respuesta';
      regenerateButton.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4v6h6"></path><path d="M23 20v-6h-6"></path><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"></path></svg>';

      const copyButton = document.createElement('button');
      copyButton.className = 'copy-message-btn';
      copyButton.title = 'Copiar mensaje';
      copyButton.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';

      const timeElement = document.createElement('span');
      timeElement.className = 'message-time';

      copyContainer.appendChild(regenerateButton);
      copyContainer.appendChild(copyButton);
      
      // Añadir indicador de modelo si existe
      const conversation = state.conversations[state.activeId];
      if (conversation) {
        const assistantMessage = conversation.messages[conversation.messages.length - 1];
        if (assistantMessage && assistantMessage.role === 'assistant' && assistantMessage.model) {
          const modelIndicator = document.createElement('span');
          modelIndicator.className = 'message-model-indicator';
          modelIndicator.id = 'streaming-model-indicator'; // ID para actualizarlo en tiempo real
          
          // Mostrar modelo y tokens/segundo si está disponible
          let displayText = assistantMessage.model;
          if (assistantMessage.tokensPerSecond && assistantMessage.tokensPerSecond > 0) {
            displayText += ` • ${assistantMessage.tokensPerSecond} t/s`;
          }
          
          modelIndicator.textContent = displayText;
          modelIndicator.title = `Respondido por ${assistantMessage.model}${assistantMessage.tokensPerSecond ? ` (${assistantMessage.tokensPerSecond} tokens/segundo)` : ''}`;
          copyContainer.appendChild(modelIndicator);
        }
      }
      
      copyContainer.appendChild(timeElement);
      bubble.appendChild(copyContainer);
    } else {
      // Si ya existe el contenedor, actualizar el indicador de modelo en tiempo real
      const modelIndicator = copyContainer.querySelector('#streaming-model-indicator');
      if (modelIndicator) {
        const conversation = state.conversations[state.activeId];
        if (conversation) {
          const assistantMessage = conversation.messages[conversation.messages.length - 1];
          if (assistantMessage && assistantMessage.tokensPerSecond && assistantMessage.tokensPerSecond > 0) {
            const displayText = `${assistantMessage.model} • ${assistantMessage.tokensPerSecond} t/s`;
            modelIndicator.textContent = displayText;
            modelIndicator.title = `Respondido por ${assistantMessage.model} (${assistantMessage.tokensPerSecond} tokens/segundo)`;
          }
        }
      }
    }

    // Actualizar el evento de regenerar
    const regenerateButton = copyContainer.querySelector('.regenerate-message-btn');
    if (regenerateButton) {
      regenerateButton.onclick = async (e) => {
        e.stopPropagation();
        // Obtener el ID del mensaje del asistente actual
        const conversation = state.conversations[state.activeId];
        if (conversation) {
          const assistantMessage = conversation.messages[conversation.messages.length - 1];
          if (assistantMessage && assistantMessage.role === 'assistant') {
            await regenerateResponse(assistantMessage.id);
          }
        }
      };
    }

    // Actualizar el evento de copiar con el texto actual
    const copyButton = copyContainer.querySelector('.copy-message-btn');
    if (copyButton) {
      copyButton.onclick = async (e) => {
        e.stopPropagation();
        await copyToClipboard(text || '', copyButton);
      };
    }

    // Actualizar la hora si existe
    const timeElement = copyContainer.querySelector('.message-time');
    if (timeElement) {
      // Obtener el timestamp del mensaje actual de la conversación
      const conversation = state.conversations[state.activeId];
      if (conversation) {
        const assistantMessage = conversation.messages[conversation.messages.length - 1];
        if (assistantMessage && assistantMessage.role === 'assistant') {
          const messageTime = assistantMessage.timestamp || assistantMessage.createdAt || Date.now();
          timeElement.textContent = formatTime(messageTime);
        }
      }
    }

    // Scroll solo si ha pasado suficiente tiempo y no se debe saltar
    if (!skipScroll) {
      const now = Date.now();
      if (now - lastScrollUpdateTime >= SCROLL_UPDATE_INTERVAL) {
        scrollChatToBottom();
        lastScrollUpdateTime = now;
      }
    }

    // Scroll automático del thinking-content hacia el final cuando está cargando
    const thinkingContent = bubble.querySelector('.thinking-content-streaming');
    if (thinkingContent) {
      thinkingContent.scrollTop = thinkingContent.scrollHeight;
    }
  });
}

function syncModelSelects() {
  if (modelSelect && modelSelectInline) {
    modelSelectInline.value = modelSelect.value;
  }
}

async function loadModels() {
  const selects = [modelSelect, modelSelectInline].filter(Boolean);
  if (selects.length === 0) return;

  const storedModel = state.currentModel ?? selects[0].value;
  selects.forEach(select => {
    select.innerHTML = '<option>Cargando modelos...</option>';
    select.disabled = true;
  });

  try {
    const response = await fetch(`${API_BASE}/api/tags`);
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    const models = data?.models ?? [];

    if (models.length === 0) {
      selects.forEach(select => {
        select.innerHTML = '<option>No se encontraron modelos</option>';
      });
      state.currentModel = null;
      persistState();
      return;
    }

    selects.forEach(select => {
      select.innerHTML = '';
      models.forEach((model) => {
        const option = document.createElement('option');
        option.value = model.name;

        // Formatear nombre del modelo
        let displayName = model.name;

        // Limpiar el nombre y extraer información
        if (model.name.includes(':')) {
          const parts = model.name.split(':');
          const baseName = parts[0];
          const tag = parts[1] || '';

          // Capitalizar primera letra del nombre base
          const formattedBase = baseName.charAt(0).toUpperCase() + baseName.slice(1);

          // Formatear el tag
          let formattedTag = tag;
          if (tag.includes('-')) {
            // Para tags como "7b-instruct-v0.3-q4_K_M"
            const tagParts = tag.split('-');
            const size = tagParts[0]; // "7b"
            const variant = tagParts.slice(1).filter(p =>
              !p.toLowerCase().includes('q') &&
              !p.toLowerCase().includes('_')
            ).join(' ');

            formattedTag = size.toUpperCase();
            if (variant) {
              formattedTag += ` ${variant}`;
            }
          } else {
            formattedTag = tag.toUpperCase();
          }

          displayName = `${formattedBase} ${formattedTag}`;
        } else {
          // Si no tiene ':', capitalizar
          displayName = model.name.charAt(0).toUpperCase() + model.name.slice(1);
        }

        option.textContent = displayName;
        select.appendChild(option);
      });
    });

    const initial = models.find((m) => m.name === storedModel) ?? models[0];
    state.currentModel = initial.name;
    selects.forEach(select => {
      select.value = initial.name;
    });
    persistState();
  } catch (error) {
    console.error('No se pudieron cargar modelos', error);
    selects.forEach(select => {
      select.innerHTML = '<option>Error al cargar modelos</option>';
    });
  } finally {
    selects.forEach(select => {
      select.disabled = false;
    });

    // Refrescar el selector custom tras cargar modelos
    enhanceAllModelSelects(selects);
  }
}

// Mejora visual del selector de modelos para que coincida con la estética del sitio
function enhanceAllModelSelects(selects = []) {
  const list = selects.length ? selects : [modelSelect, modelSelectInline].filter(Boolean);
  list.forEach(enhanceModelSelect);
}

function enhanceModelSelect(select) {
  if (!select) return;
  const wrapper = select.closest('.model-select-wrapper') || select.parentElement;
  if (!wrapper) return;

  // Ocultar nativo pero mantenerlo en el DOM para formularios
  select.classList.add('native-model-select-hidden');

  // Crear contenedores si no existen
  let display = wrapper.querySelector('.model-select-display');
  let dropdown = wrapper.querySelector('.model-select-dropdown');

  if (!display) {
    display = document.createElement('button');
    display.type = 'button';
    display.className = 'model-select-display';
    display.innerHTML = '<span class=\"model-select-label\"></span><span class=\"model-select-arrow\">▾</span>';

    dropdown = document.createElement('div');
    dropdown.className = 'model-select-dropdown';

    wrapper.appendChild(display);
    wrapper.appendChild(dropdown);
  } else if (dropdown) {
    dropdown.innerHTML = '';
  }

  const label = display.querySelector('.model-select-label');

  const closeDropdown = () => {
    dropdown?.classList.remove('open');
  };

  const openDropdown = () => {
    dropdown?.classList.add('open');
  };

  const rebuildItems = () => {
    if (!dropdown) return;
    dropdown.innerHTML = '';

    select.querySelectorAll('option').forEach(opt => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'model-select-item';
      item.textContent = opt.textContent;
      if (opt.value === select.value) {
        item.classList.add('active');
      }

      item.addEventListener('click', () => {
        select.value = opt.value;
        // Disparar change para lógica existente
        select.dispatchEvent(new Event('change', { bubbles: true }));
        if (label) label.textContent = opt.textContent;
        dropdown.querySelectorAll('.model-select-item').forEach(btn => btn.classList.remove('active'));
        item.classList.add('active');
        closeDropdown();
      });

      dropdown.appendChild(item);
    });
  };

  // Construir contenido inicial
  if (label) {
    const selected = select.selectedOptions[0];
    label.textContent = selected ? selected.textContent : select.value;
  }
  rebuildItems();

  // Toggle
  display.onclick = (e) => {
    e.stopPropagation();
    const isOpen = dropdown?.classList.contains('open');
    document.querySelectorAll('.model-select-dropdown.open').forEach(dd => dd.classList.remove('open'));
    if (!isOpen) openDropdown();
  };

  // Cerrar al hacer clic fuera
  document.addEventListener('click', closeDropdown);
}

async function streamAssistantResponse(conversation, payloadMessages) {
  if (!state.currentModel) {
    throw new Error('Selecciona un modelo antes de enviar un mensaje.');
  }

  const assistantMessage = createMessage('assistant', '');
  assistantMessage.thinking = '';
  assistantMessage.thinkingDuration = 0;
  assistantMessage.model = state.currentModel; // Guardar el modelo usado
  assistantMessage.tokensPerSecond = 0; // Inicializar tokens por segundo
  conversation.messages.push(assistantMessage);
  touchConversation(conversation.id);
  const { bubble } = appendMessageElement(assistantMessage);

  // Mostrar indicador de "pensando"
  updateAssistantBubble(bubble, '', { isLoading: true });
  persistState();

  const startTime = Date.now();

  // Calcular el tamaño del contexto necesario basado en los mensajes
  const totalContentLength = payloadMessages.reduce((sum, msg) => sum + (msg.content?.length || 0), 0);

  // Configurar num_ctx dinámicamente según el contenido
  // 1 token ≈ 4 caracteres en promedio
  const estimatedTokens = Math.ceil(totalContentLength / 4);
  // Añadir margen para la respuesta (al menos 4000 tokens extra)
  const recommendedContext = Math.max(4096, estimatedTokens + 4000);
  // Obtener el límite del modelo (usar cache si disponible, sino usar 131072 como máximo)
  const modelInfo = modelContextCache[state.currentModel];
  const modelMaxContext = modelInfo?.contextLength || 131072;
  // Limitar al máximo del modelo
  const numCtx = Math.min(recommendedContext, modelMaxContext);

  // Inyectar contexto de cita si existe
  let messagesWithQuoteContext = [...payloadMessages];
  if (window.pendingQuoteContext) {
    // Insertar un mensaje de sistema con el contexto de la cita antes del último mensaje del usuario
    const quoteSystemMessage = {
      role: 'system',
      content: window.pendingQuoteContext
    };
    // Encontrar el índice del último mensaje del usuario
    const lastUserIdx = messagesWithQuoteContext.map(m => m.role).lastIndexOf('user');
    if (lastUserIdx > 0) {
      messagesWithQuoteContext.splice(lastUserIdx, 0, quoteSystemMessage);
    } else {
      messagesWithQuoteContext.unshift(quoteSystemMessage);
    }
    // Limpiar el contexto pendiente
    window.pendingQuoteContext = null;
  }

  const body = {
    model: state.currentModel,
    stream: true,
    messages: messagesWithQuoteContext,
    options: {
      num_ctx: numCtx // Ajustar el tamaño del contexto dinámicamente
    }
  };

  // Log para depuración (solo mostrar estructura, no el contenido completo de imágenes)
  console.log('📤 Enviando mensajes al modelo:', {
    model: body.model,
    messageCount: body.messages.length,
    totalContentLength: totalContentLength,
    estimatedTokens: estimatedTokens,
    num_ctx: numCtx,
    messages: body.messages.map(msg => ({
      role: msg.role,
      contentLength: msg.content?.length || 0,
      hasImages: !!msg.images,
      imageCount: msg.images?.length || 0,
      firstImageLength: msg.images?.[0]?.length || 0
    }))
  });

  const response = await fetch(`${API_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let errorText = '';
    try {
      errorText = await response.text();
    } catch (e) {
      // Si no se puede leer el texto del error, continuar
    }
    console.error('Error del servidor:', response.status, response.statusText, errorText);
    throw new Error(`Error al consultar el modelo: ${response.statusText}. ${errorText.substring(0, 200)}`);
  }

  if (!response.body) {
    throw new Error('No se recibió respuesta del servidor');
  }

  const reader = response.body.getReader();
  currentStreamReader = reader; // Guardar el reader para poder cancelarlo
  updateSendButtonToStop();

  const decoder = new TextDecoder();
  let buffer = '';
  let isFirstChunk = true;
  let thinkingComplete = false;
  let isThinkingStreaming = false;
  wasCancelled = false; // Resetear el flag de cancelación
  let canvasProcessed = false;
  let streamedTokens = 0; // Contador de tokens en tiempo real

  // Sistema de batching para actualizaciones suaves
  let pendingUpdate = false;
  let updateScheduled = false;
  let lastUpdateTime = 0;
  const UPDATE_INTERVAL = 16; // ~60fps (16ms)
  const BATCH_SIZE = 50; // Número de caracteres antes de forzar actualización

  // Función para programar actualización del DOM
  const scheduleUpdate = () => {
    if (updateScheduled) return;
    updateScheduled = true;

    requestAnimationFrame(() => {
      updateScheduled = false;
      const now = Date.now();

      // Solo actualizar si ha pasado suficiente tiempo o hay mucho contenido pendiente
      const currentTextLength = bubble.textContent?.length || 0;
      const contentDiff = assistantMessage.content.length - currentTextLength;

      if (now - lastUpdateTime >= UPDATE_INTERVAL || contentDiff > BATCH_SIZE) {
        const thinkingData = assistantMessage.thinking ? {
          thinking: assistantMessage.thinking,
          duration: assistantMessage.thinkingDuration,
          isLoading: isThinkingStreaming
        } : null;

        // Solo hacer scroll si hay mucho contenido nuevo
        const skipScroll = contentDiff < 20;
        updateAssistantBubble(bubble, assistantMessage.content, thinkingData, skipScroll);
        lastUpdateTime = now;
        pendingUpdate = false;
      } else {
        // Reprogramar si aún no es tiempo
        scheduleUpdate();
      }
    });
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);

          // Capturar el razonamiento del modelo (si está disponible)
          // Algunos modelos envían esto en diferentes campos
          if (parsed.thinking || parsed.reasoning || parsed.thought || parsed.message?.thinking) {
            isThinkingStreaming = true;
            const thinkingText = parsed.thinking || parsed.reasoning || parsed.thought || parsed.message?.thinking;

            assistantMessage.thinking += thinkingText;
            const duration = ((Date.now() - startTime) / 1000).toFixed(0);
            assistantMessage.thinkingDuration = duration;

            // Actualizar inmediatamente para thinking (con scroll)
            updateAssistantBubble(bubble, assistantMessage.content, {
              thinking: assistantMessage.thinking,
              duration: duration,
              isLoading: true
            }, false);
            thinkingComplete = true;
            // No persistir en cada chunk de thinking, solo al final
          }

          if (parsed.message?.content) {
            isThinkingStreaming = false;
            const contentChunk = parsed.message.content;

            // Detectar si el contenido contiene marcadores de razonamiento
            // Algunos modelos incluyen el razonamiento en el contenido con tags especiales
            // Varios formatos posibles: <think>, <reasoning>, <thought>, etc.
            const thinkingPatterns = [
              /<think>([\s\S]*?)<\/think>/i,
              /<reasoning>([\s\S]*?)<\/reasoning>/i,
              /<thought>([\s\S]*?)<\/thought>/i,
              /<think>([\s\S]*?)<\/redacted_reasoning>/i,
              /\[thinking\]([\s\S]*?)\[\/thinking\]/i,
              /\[reasoning\]([\s\S]*?)\[\/reasoning\]/i
            ];

            let thinkingFound = false;
            let cleanContent = contentChunk;

            for (const pattern of thinkingPatterns) {
              const match = contentChunk.match(pattern);
              if (match && match[1]) {
                // Agregar salto de línea si ya hay thinking previo
                if (assistantMessage.thinking && !assistantMessage.thinking.endsWith('\n')) {
                  assistantMessage.thinking += '\n';
                }
                assistantMessage.thinking += match[1];
                const duration = ((Date.now() - startTime) / 1000).toFixed(0);
                assistantMessage.thinkingDuration = duration;
                thinkingComplete = true;
                thinkingFound = true;
                // Remover el tag de pensamiento del contenido
                cleanContent = contentChunk.replace(pattern, '').trim();
                break;
              }
            }

            if (thinkingFound) {
              // Si hay contenido limpio después de extraer el thinking, agregarlo
              if (cleanContent) {
                assistantMessage.content += cleanContent;
                pendingUpdate = true;
                scheduleUpdate();
              } else {
                // Si solo había thinking, actualizar la vista inmediatamente
                const thinkingData = assistantMessage.thinking ? {
                  thinking: assistantMessage.thinking,
                  duration: assistantMessage.thinkingDuration
                } : null;
                updateAssistantBubble(bubble, assistantMessage.content, thinkingData, false);
              }
            } else {
              // Si es el primer chunk y no hay pensamiento explícito, registrar el tiempo de primera respuesta
              if (isFirstChunk && !thinkingComplete) {
                const duration = ((Date.now() - startTime) / 1000).toFixed(0);
                assistantMessage.thinkingDuration = duration;

                // Solo mostrar el indicador de pensamiento genérico si tomó más de 1 segundo
                // Y NO hay thinking real capturado
                if (duration > 1 && !assistantMessage.thinking) {
                  assistantMessage.thinking = `Procesó la solicitud en ${duration} segundos antes de responder...`;
                }

                isFirstChunk = false;
              }

              assistantMessage.content += contentChunk;
              
              // Actualizar contador de tokens en tiempo real
              streamedTokens = Math.ceil(assistantMessage.content.length / 3.5);
              const currentTime = (Date.now() - startTime) / 1000;
              const currentTokensPerSecond = currentTime > 0 ? Math.round(streamedTokens / currentTime) : 0;
              assistantMessage.tokensPerSecond = currentTokensPerSecond;

              // Detectar si estamos recibiendo JSON de canvas para no mostrarlo
              if (!canvasProcessed && assistantMessage.content.includes('"type"') && assistantMessage.content.includes('"canvas"')) {
                // Verificar si es un JSON de canvas completo
                const tempPayload = parseCanvasPayload(assistantMessage.content);
                if (tempPayload) {
                  // Es un canvas completo, procesarlo ahora
                  canvasProcessed = processCanvasResponse(conversation, assistantMessage);
                  if (canvasProcessed) {
                    renderCanvasPanel(conversation.id);
                    // Actualizar el bubble con el mensaje procesado (sin JSON)
                    const thinkingData = assistantMessage.thinking ? {
                      thinking: assistantMessage.thinking,
                      duration: assistantMessage.thinkingDuration
                    } : null;
                    updateAssistantBubble(bubble, assistantMessage.content, thinkingData, false);
                    pendingUpdate = false; // Ya actualizamos
                    continue; // Saltar al siguiente chunk
                  }
                }
              }

              // Procesar comandos de viajes si estamos en modo travel
              if (state.chatMode === 'travel' && assistantMessage.content) {
                processTravelCommands(assistantMessage.content);
              }

              pendingUpdate = true;

              // Programar actualización de forma asíncrona
              scheduleUpdate();
            }
          }

          if (parsed.error) {
            throw new Error(parsed.error);
          }

          if (parsed.done) {
            // Calcular tokens por segundo
            const responseTime = (Date.now() - startTime) / 1000;
            const estimatedTokens = Math.ceil(assistantMessage.content.length / 3.5);
            assistantMessage.tokensPerSecond = responseTime > 0 ? Math.round(estimatedTokens / responseTime) : 0;
            
            // Actualización final inmediata cuando termina (con scroll)
            const thinkingData = assistantMessage.thinking ? {
              thinking: assistantMessage.thinking,
              duration: assistantMessage.thinkingDuration
            } : null;

            updateAssistantBubble(bubble, assistantMessage.content, thinkingData, false);
            conversation.updatedAt = Date.now();
            persistState();
            renderConversationList();
            currentStreamReader = null;
            updateStopButtonToSend();

            // Registrar estadísticas de uso
            trackModelUsage(state.currentModel);
            trackDailyMessage();
            trackResponseTime(responseTime);

            if (!canvasProcessed) {
              canvasProcessed = processCanvasResponse(conversation, assistantMessage);
              if (canvasProcessed) {
                // Re-renderizar el mensaje completo para mostrar la tarjeta
                bubble.innerHTML = '';

                // Agregar pensamiento si existe
                if (thinkingData && thinkingData.thinking) {
                  bubble.innerHTML += createThinkingBlock(thinkingData.thinking, thinkingData.duration, false);
                }

                // Procesar el contenido con la tarjeta de artifact
                const canvasDoc = getCanvasDoc(conversation.id);
                const messageVersion = assistantMessage.canvasVersion || canvasDoc?.version || 1;
                const parts = assistantMessage.content.split('[CANVAS_ARTIFACT]');

                if (parts.length > 1 && canvasDoc) {
                  // Hay marcador de artifact
                  if (parts[0]) {
                    bubble.innerHTML += parseMarkdown(parts[0]);
                  }

                  // Insertar tarjeta de artifact
                  bubble.innerHTML += createArtifactCard({
                    title: canvasDoc.title,
                    content: canvasDoc.content,
                    canvasId: canvasDoc.id,
                    version: messageVersion
                  });

                  if (parts[1]) {
                    bubble.innerHTML += parseMarkdown(parts[1]);
                  }
                } else {
                  // Sin marcador, solo parsear markdown
                  bubble.innerHTML += parseMarkdown(assistantMessage.content);
                }

                // Volver a agregar los botones de acción
                const copyContainer = bubble.querySelector('.copy-message-container');
                if (!copyContainer) {
                  const newCopyContainer = document.createElement('div');
                  newCopyContainer.className = 'copy-message-container';

                  const copyButton = document.createElement('button');
                  copyButton.className = 'copy-message-btn';
                  copyButton.title = 'Copiar mensaje';
                  copyButton.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';

                  newCopyContainer.appendChild(copyButton);
                  
                  // Añadir indicador de modelo si existe
                  if (assistantMessage.model) {
                    const modelIndicator = document.createElement('span');
                    modelIndicator.className = 'message-model-indicator';
                    
                    // Mostrar modelo y tokens/segundo si está disponible
                    let displayText = assistantMessage.model;
                    if (assistantMessage.tokensPerSecond && assistantMessage.tokensPerSecond > 0) {
                      displayText += ` • ${assistantMessage.tokensPerSecond} t/s`;
                    }
                    
                    modelIndicator.textContent = displayText;
                    modelIndicator.title = `Respondido por ${assistantMessage.model}${assistantMessage.tokensPerSecond ? ` (${assistantMessage.tokensPerSecond} tokens/segundo)` : ''}`;
                    newCopyContainer.appendChild(modelIndicator);
                  }
                  
                  const timeElement = document.createElement('span');
                  timeElement.className = 'message-time';
                  timeElement.textContent = formatTime(assistantMessage.timestamp || Date.now());

                  newCopyContainer.appendChild(timeElement);
                  bubble.appendChild(newCopyContainer);
                }

                // Renderizar las tarjetas si existen
                renderCanvasPanel(conversation.id);
              }
            }

            // Extraer información importante automáticamente
            const lastUserMessage = conversation.messages.filter(m => m.role === 'user').pop();
            if (lastUserMessage && assistantMessage.content) {
              // Usar extracción simple primero (más rápida)
              const simpleExtracted = extractInfoSimple(lastUserMessage.content, assistantMessage.content);
              let addedCount = 0;
              simpleExtracted.forEach(info => {
                if (info && !memoryExists(info)) {
                  addMemory(info);
                  addedCount++;
                }
              });

              // Actualizar lista si se añadieron memorias
              if (addedCount > 0 && typeof window.renderMemoriesList === 'function') {
                window.renderMemoriesList();
              }

              // Si no se encontró nada con el método simple y hay suficiente contenido, usar IA
              if (simpleExtracted.length === 0 && assistantMessage.content.length > 100) {
                // Ejecutar en segundo plano sin bloquear
                setTimeout(() => {
                  extractImportantInfoFromConversation(lastUserMessage.content, assistantMessage.content);
                }, 500);
              }
            }

            // Scroll final garantizado
            setTimeout(() => scrollChatToBottom(), 0);
            return;
          }
        } catch (parseError) {
          console.warn('No se pudo analizar un fragmento del stream', parseError, line);
        }
      }

      // Dar tiempo al navegador periódicamente
      if (Math.random() < 0.1) { // ~10% de las veces
        await yieldToBrowser();
      }
    }

    // Asegurar última actualización si hay contenido pendiente
    if (pendingUpdate) {
      const thinkingData = assistantMessage.thinking ? {
        thinking: assistantMessage.thinking,
        duration: assistantMessage.thinkingDuration
      } : null;
      updateAssistantBubble(bubble, assistantMessage.content, thinkingData, false);

      // Registrar estadísticas de uso
      const responseTime = (Date.now() - startTime) / 1000;
      trackModelUsage(state.currentModel);
      trackDailyMessage();
      trackResponseTime(responseTime);

      if (!canvasProcessed) {
        canvasProcessed = processCanvasResponse(conversation, assistantMessage);
        if (canvasProcessed) {
          // Re-renderizar el mensaje completo para mostrar la tarjeta
          bubble.innerHTML = '';

          // Agregar pensamiento si existe
          if (thinkingData && thinkingData.thinking) {
            bubble.innerHTML += createThinkingBlock(thinkingData.thinking, thinkingData.duration, false);
          }

          // Agregar contenido con la tarjeta
          bubble.innerHTML += parseMarkdown(assistantMessage.content);

          // Volver a agregar los botones de acción
          const copyContainer = bubble.querySelector('.copy-message-container');
          if (!copyContainer) {
            const newCopyContainer = document.createElement('div');
            newCopyContainer.className = 'copy-message-container';

            const copyButton = document.createElement('button');
            copyButton.className = 'copy-message-btn';
            copyButton.title = 'Copiar mensaje';
            copyButton.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';

            newCopyContainer.appendChild(copyButton);
            
            // Añadir indicador de modelo si existe
            if (assistantMessage.model) {
              const modelIndicator = document.createElement('span');
              modelIndicator.className = 'message-model-indicator';
              
              // Mostrar modelo y tokens/segundo si está disponible
              let displayText = assistantMessage.model;
              if (assistantMessage.tokensPerSecond && assistantMessage.tokensPerSecond > 0) {
                displayText += ` • ${assistantMessage.tokensPerSecond} t/s`;
              }
              
              modelIndicator.textContent = displayText;
              modelIndicator.title = `Respondido por ${assistantMessage.model}${assistantMessage.tokensPerSecond ? ` (${assistantMessage.tokensPerSecond} tokens/segundo)` : ''}`;
              newCopyContainer.appendChild(modelIndicator);
            }
            
            const timeElement = document.createElement('span');
            timeElement.className = 'message-time';
            timeElement.textContent = formatTime(assistantMessage.timestamp || Date.now());

            newCopyContainer.appendChild(timeElement);
            bubble.appendChild(newCopyContainer);
          }

          // Renderizar las tarjetas si existen
          renderCanvasPanel(conversation.id);
        }
      }

      // Procesar respuesta de música si contiene [PARTITURA] - SIEMPRE verificar
      const hasPartitura = assistantMessage.content?.includes('[PARTITURA]');
      if (hasPartitura) {
        console.log('🎵 Detectado bloque [PARTITURA] en respuesta');
        setTimeout(() => {
          if (window.musicModeUtils?.processMusicResponse) {
            console.log('🎵 Llamando processMusicResponse...');
            window.musicModeUtils.processMusicResponse(conversation, assistantMessage);
          } else {
            console.error('🎵 musicModeUtils no disponible');
          }
        }, 200);
      }

      // Extraer información importante automáticamente al finalizar
      const lastUserMessage = conversation.messages.filter(m => m.role === 'user').pop();
      if (lastUserMessage && assistantMessage.content) {
        // Usar extracción simple primero (más rápida)
        const simpleExtracted = extractInfoSimple(lastUserMessage.content, assistantMessage.content);
        let addedCount = 0;
        simpleExtracted.forEach(info => {
          if (info && !memoryExists(info)) {
            addMemory(info);
            addedCount++;
          }
        });

        // Actualizar lista si se añadieron memorias
        if (addedCount > 0 && typeof window.renderMemoriesList === 'function') {
          window.renderMemoriesList();
        }

        // Si no se encontró nada con el método simple y hay suficiente contenido, usar IA
        if (simpleExtracted.length === 0 && assistantMessage.content.length > 100) {
          // Ejecutar en segundo plano sin bloquear
          setTimeout(() => {
            extractImportantInfoFromConversation(lastUserMessage.content, assistantMessage.content);
          }, 500);
        }
      }

      // Scroll final garantizado
      setTimeout(() => scrollChatToBottom(), 0);
    }
  } catch (error) {
    // Si el error es por cancelación, no lanzarlo
    if (error.name === 'AbortError' || error.message?.includes('cancel')) {
      wasCancelled = true;
    } else {
      throw error;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch (e) {
      // Ignorar errores al liberar el lock
    }
    currentStreamReader = null;
    updateStopButtonToSend();

    // No agregar mensaje aquí, ya se hace en stopStream()
    // Solo actualizar el bubble si no fue cancelado
    if (wasCancelled) {
      const currentContent = bubble?.textContent || '';
      if (!currentContent.includes('cancelada')) {
        updateAssistantBubble(bubble, assistantMessage.content, null);
        persistState();
      }
    }

    // SIEMPRE intentar procesar música al finalizar, incluso si hubo error (como 500)
    // Detectar tanto ABC como el formato antiguo PARTITURA
    const hasMusic = assistantMessage.content?.includes('[ABC]') ||
      assistantMessage.content?.includes('```abc') ||
      assistantMessage.content?.includes('[PARTITURA]');
    if (hasMusic && !wasCancelled) {
      console.log('🎵 Fin de stream (o error) - Procesando partitura detectada');
      setTimeout(() => {
        if (window.musicModeUtils?.processMusicResponse) {
          window.musicModeUtils.processMusicResponse(conversation, assistantMessage, bubble);
        }
      }, 500);
    }

    // Procesar Score Canvas edits (collaborative score)
    const hasScoreEdit = assistantMessage.content?.includes('[SCORE_EDIT]');
    if (hasScoreEdit && !wasCancelled) {
      console.log('🎼 Fin de stream - Procesando SCORE_EDIT detectado');
      setTimeout(() => {
        if (typeof processScoreResponse === 'function') {
          processScoreResponse(conversation, assistantMessage, bubble);
        }
      }, 500);
    }

    // Procesar comandos de viajes (TRAVEL_MAP, PLACE, GMAPS_ROUTE)
    const hasTravelCommands = assistantMessage.content?.includes('[TRAVEL_MAP]') ||
      assistantMessage.content?.includes('[PLACE:') ||
      assistantMessage.content?.includes('[GMAPS_ROUTE]');
    if (hasTravelCommands && !wasCancelled) {
      console.log('🗺️ Fin de stream - Procesando comandos de viaje detectados');
      setTimeout(() => {
        if (window.travelMode?.parseCommands && window.travelMode?.renderComponents) {
          const travelData = window.travelMode.parseCommands(assistantMessage.content);
          console.log('🗺️ Datos parseados:', travelData.hasTravel, 'Lugares:', travelData.places.length);
          if (travelData.hasTravel && travelData.places.length > 0) {
            // IMPORTANTE: Guardar data de viaje en el mensaje para persistencia
            assistantMessage.travelPlaces = travelData.places;
            assistantMessage.cleanContent = travelData.text; // Guardar contenido limpio

            // Buscar el contenedor del mensaje
            const chatList = document.getElementById('chat-list');
            const lastMessage = chatList?.lastElementChild;
            const messageBubble = lastMessage?.querySelector('.message-bubble');

            console.log('🗺️ messageBubble encontrado:', !!messageBubble);

            if (messageBubble) {
              // Actualizar el texto del mensaje sin los comandos
              const cleanContent = travelData.text;
              console.log('🗺️ Contenido limpio:', cleanContent.substring(0, 100) + '...');

              // Limpiar directamente el innerHTML del bubble eliminando TODOS los comandos de viaje
              // Primero eliminar bloques TRAVEL_MAP completos (incluyendo todo su contenido)
              let bubbleHtml = messageBubble.innerHTML;
              // Eliminar bloques TRAVEL_MAP completos con todo su contenido
              bubbleHtml = bubbleHtml.replace(/\[TRAVEL_MAP\][\s\S]*?\[\/TRAVEL_MAP\]/g, '');
              // Eliminar PLACE tags sueltos que pudieran quedar
              bubbleHtml = bubbleHtml.replace(/\[PLACE:[^\]]+\]/g, '');
              // Eliminar GMAPS_ROUTE tags sueltos
              bubbleHtml = bubbleHtml.replace(/\[GMAPS_ROUTE\]/g, '');
              // Limpiar <br> excesivos que queden
              bubbleHtml = bubbleHtml.replace(/(<br\s*\/?>[\s\n]*){3,}/gi, '<br><br>');
              bubbleHtml = bubbleHtml.trim();

              // Si el cleanContent está vacío (todo era TRAVEL_MAP), vaciar el bubble
              if (!cleanContent || cleanContent.trim() === '') {
                bubbleHtml = '';
              }

              messageBubble.innerHTML = bubbleHtml;

              // Renderizar componentes de viaje
              setTimeout(() => {
                console.log('🗺️ Renderizando componentes de viaje...');
                window.travelMode.renderComponents(messageBubble, travelData);
                persistState(); // Persistir CON travelPlaces incluido
              }, 100);
            }
          }
        }
      }, 700);
    }

    // Procesar comandos de salud (HEALTH_RECIPE, HEALTH_ROUTINE, etc.)
    const hasHealthCommands = window.healthMode?.hasContent && window.healthMode.hasContent(assistantMessage.content || '');
    if (hasHealthCommands && !wasCancelled) {
      console.log('🏥 Fin de stream - Procesando comandos de salud detectados');
      setTimeout(() => {
        const healthData = window.healthMode.parseCommands(assistantMessage.content);
        if (healthData) {
          const chatList = document.getElementById('chat-list');
          const lastMessage = chatList?.lastElementChild;
          const messageBubble = lastMessage?.querySelector('.message-bubble');

          if (messageBubble) {
            // Re-renderizar desde el contenido original limpio (sin tags de salud)
            const cleanedContent = window.healthMode.cleanTags(assistantMessage.content);
            
            // Preservar bloques de pensamiento si existen
            const thinkingBlock = messageBubble.querySelector('.thinking-block');
            const copyContainer = messageBubble.querySelector('.copy-message-container');
            
            // Limpiar el bubble y re-renderizar
            const parsedClean = parseMarkdown(cleanedContent);
            
            // Reconstruir: pensamiento + contenido limpio
            let newHTML = '';
            if (thinkingBlock) {
              newHTML += thinkingBlock.outerHTML;
            }
            newHTML += parsedClean;
            if (copyContainer) {
              newHTML += copyContainer.outerHTML;
            }
            messageBubble.innerHTML = newHTML;

            // Re-attach event listeners para copiar/regenerar
            const newCopyBtn = messageBubble.querySelector('.copy-message-btn');
            if (newCopyBtn) {
              newCopyBtn.addEventListener('click', () => {
                const textToCopy = assistantMessage.content || '';
                navigator.clipboard.writeText(textToCopy).catch(() => {});
              });
            }

            // Renderizar componentes visuales de salud
            window.healthMode.renderComponents(messageBubble, healthData);
            persistState();
          }
        }
      }, 800);
    }
  }
}

function stopStream() {
  if (currentStreamReader) {
    wasCancelled = true; // Marcar como cancelado antes de cancelar
    currentStreamReader.cancel();
    state.loading = false;

    // Actualizar inmediatamente el bubble para eliminar la animación de carga
    const chatList = document.getElementById('chat-list');
    const lastMessage = chatList?.lastElementChild;
    if (lastMessage) {
      const bubble = lastMessage.querySelector('.message-bubble');
      if (bubble) {
        // Buscar el mensaje de asistente actual en el estado
        const conversation = state.conversations[state.activeId];
        if (conversation) {
          const assistantMessage = conversation.messages[conversation.messages.length - 1];
          if (assistantMessage && assistantMessage.role === 'assistant') {
            assistantMessage.content += (assistantMessage.content ? '\n\n' : '') + '⚠️ Respuesta cancelada por el usuario.';
            updateAssistantBubble(bubble, assistantMessage.content, null);
            persistState();
          }
        }
      }
    }
  }
}

// Variable para almacenar el ID del mensaje a editar
let messageToEdit = null;

// Función para abrir el modal de edición de mensaje
function openEditMessageModal(messageId) {
  const conversation = state.conversations[state.activeId];
  if (!conversation) return;

  const message = conversation.messages.find(msg => msg.id === messageId);
  if (!message || message.role !== 'user') return;

  messageToEdit = messageId;
  const modal = document.getElementById('edit-message-modal');
  const textarea = document.getElementById('edit-message-textarea');

  if (modal && textarea) {
    textarea.value = message.content || '';
    modal.style.display = 'flex';

    // Animar la entrada del modal
    const content = modal.querySelector('.modal-content');
    if (content) {
      content.style.animation = 'none';
      content.offsetHeight; // Forzar reflow
      content.style.animation = 'slideDown 0.3s ease';
    }

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }, 100);
  }
}

// Función para cerrar el modal de edición
function closeEditMessageModal() {
  const modal = document.getElementById('edit-message-modal');
  if (modal) {
    const content = modal.querySelector('.modal-content');
    if (content) {
      content.style.animation = 'slideUp 0.2s ease reverse';
      setTimeout(() => {
        modal.style.display = 'none';
        content.style.animation = '';
      }, 200);
    } else {
      modal.style.display = 'none';
    }
  }
  messageToEdit = null;
}

// Función para confirmar la edición y regenerar desde ese punto
async function confirmEditMessage() {
  if (!messageToEdit || state.loading) return;

  const conversation = state.conversations[state.activeId];
  if (!conversation) return;

  const textarea = document.getElementById('edit-message-textarea');
  if (!textarea) return;

  const newContent = textarea.value.trim();
  if (!newContent) return;

  // Encontrar el índice del mensaje a editar
  const messageIndex = conversation.messages.findIndex(msg => msg.id === messageToEdit);
  if (messageIndex === -1) return;

  const message = conversation.messages[messageIndex];
  if (message.role !== 'user') return;

  // Cerrar el modal
  closeEditMessageModal();

  // Actualizar el contenido del mensaje
  message.content = newContent;

  // Eliminar todos los mensajes posteriores (respuestas del asistente y mensajes siguientes)
  const messagesToRemove = conversation.messages.length - messageIndex - 1;
  conversation.messages.splice(messageIndex + 1, messagesToRemove);

  // Re-renderizar la conversación completa
  renderActiveConversation();

  // Guardar el estado
  persistState();

  // Preparar los mensajes para la solicitud
  const payloadMessages = [];

  // Agregar información personal del usuario como contexto del sistema
  const personalInfo = getAIPersonalization();

  // Obtener contexto del proyecto activo
  const activeProject = getActiveProject();
  const projectContext = activeProject ? buildProjectContext(activeProject) : '';

  // Obtener archivos adjuntos
  const currentFiles = attachedFiles[conversation.id] || [];
  const imageFiles = currentFiles.filter(f => f.isImage);
  const textFiles = currentFiles.filter(f => !f.isImage);

  // Construir mensaje del sistema
  const shouldIncludeProjectContext = projectContext && projectContext.length > 0;
  let memoryContext = '';
  const isFirstUserMessage = messageIndex === 0;

  if (isFirstUserMessage) {
    memoryContext = buildMemoryContext() || '';
  }

  if (isFirstUserMessage || shouldIncludeProjectContext) {
    let systemContent = '';

    if (projectContext) {
      systemContent += projectContext + '\n\n';
    }

    if (isFirstUserMessage) {
      if (memoryContext) {
        systemContent += memoryContext + '\n\n';
      }

      if (personalInfo.trim()) {
        systemContent += `Información personal del usuario: ${personalInfo.trim()}\n\n`;
      }
    }

    if (textFiles.length > 0) {
      systemContent += '=== DOCUMENTOS ADJUNTOS AL CHAT (DEBES LEER Y USAR ESTE CONTENIDO) ===\n\n';
      textFiles.forEach((file, index) => {
        systemContent += `══════════════════════════════════════════════════════════════\n`;
        systemContent += `📄 DOCUMENTO ${index + 1}: ${file.name}\n`;
        systemContent += `══════════════════════════════════════════════════════════════\n\n`;
        systemContent += `${file.content}\n\n`;
      });
      systemContent += '=== FIN DE DOCUMENTOS ADJUNTOS ===\n\n';
    }

    const responseStyle = getAIResponseStyle();
    const styleInstructions = getStyleInstructions(responseStyle);

    let instructions = '';
    const hasDocuments = textFiles.length > 0 || shouldIncludeProjectContext;
    const hasPersonalContext = personalInfo.trim() || memoryContext;

    if (hasDocuments) {
      instructions = 'IMPORTANTE: Se te han proporcionado documentos arriba. DEBES leer y usar el contenido de estos documentos para responder las preguntas del usuario.';
    } else if (hasPersonalContext) {
      instructions = 'Ten en cuenta esta información sobre el usuario al responder sus preguntas.';
    }

    if (systemContent || styleInstructions || instructions) {
      let finalContent = systemContent;

      if (styleInstructions) {
        if (finalContent) finalContent += '\n';
        finalContent += `Instrucciones de estilo de respuesta: ${styleInstructions}`;
      }

      if (instructions) {
        if (finalContent) finalContent += '\n\n';
        finalContent += instructions;
      }

      if (finalContent.trim()) {
        payloadMessages.push({
          role: 'system',
          content: finalContent.trim()
        });
      }
    }
  }

  // Añadir los mensajes de la conversación (hasta el mensaje editado, inclusive)
  for (let i = 0; i <= messageIndex; i++) {
    const msg = conversation.messages[i];
    const payloadMessage = {
      role: msg.role,
      content: msg.content || '',
    };

    // Solo añadir imágenes al último mensaje del usuario
    const isLastUserMessage = msg.role === 'user' && i === messageIndex && imageFiles.length > 0;

    if (isLastUserMessage) {
      payloadMessage.images = imageFiles.map(file => {
        if (file.content && file.content.startsWith('data:')) {
          return file.content.split(',')[1];
        }
        return file.content;
      }).filter(img => img !== null);
    }

    payloadMessages.push(payloadMessage);
  }

  state.loading = true;

  try {
    await streamAssistantResponse(conversation, payloadMessages);
  } catch (error) {
    console.error(error);
    const assistantMessage = conversation.messages[conversation.messages.length - 1];
    if (assistantMessage?.role === 'assistant') {
      if (error.name !== 'AbortError' && !error.message.includes('cancel')) {
        assistantMessage.content = `⚠️ ${error.message}`;
        const chatListElement = document.getElementById('chat-list');
        const lastBubble = chatListElement?.lastElementChild?.querySelector('.message-bubble');
        updateAssistantBubble(lastBubble, assistantMessage.content);
        persistState();
      }
    }
  } finally {
    state.loading = false;
    currentStreamReader = null;
    updateStopButtonToSend();
  }
}

// Función para regenerar la respuesta de un mensaje del asistente
async function regenerateResponse(messageId) {
  if (state.loading) return;

  const conversation = state.conversations[state.activeId];
  if (!conversation) return;

  // Encontrar el índice del mensaje del asistente
  const messageIndex = conversation.messages.findIndex(msg => msg.id === messageId);
  if (messageIndex === -1) return;

  const assistantMessage = conversation.messages[messageIndex];
  if (assistantMessage.role !== 'assistant') return;

  // Verificar que hay un mensaje de usuario antes de este mensaje del asistente
  const userMessageIndex = messageIndex - 1;
  if (userMessageIndex < 0 || conversation.messages[userMessageIndex].role !== 'user') {
    console.warn('No se encontró un mensaje de usuario antes del mensaje del asistente');
    return;
  }

  // Eliminar el mensaje del asistente del estado
  conversation.messages.splice(messageIndex, 1);

  // Eliminar el elemento del DOM
  const chatListElement = document.getElementById('chat-list');
  if (chatListElement) {
    const messageElements = chatListElement.querySelectorAll('.message');
    if (messageElements[messageIndex]) {
      messageElements[messageIndex].remove();
    }
  }

  // Guardar el estado
  persistState();

  // Preparar los mensajes para la solicitud (hasta el mensaje del usuario, inclusive)
  const payloadMessages = [];

  // Agregar información personal del usuario como contexto del sistema
  const personalInfo = getAIPersonalization();

  // Obtener contexto del proyecto activo
  const activeProject = getActiveProject();
  const projectContext = activeProject ? buildProjectContext(activeProject) : '';

  // Obtener archivos adjuntos
  const currentFiles = attachedFiles[conversation.id] || [];
  const imageFiles = currentFiles.filter(f => f.isImage);
  const textFiles = currentFiles.filter(f => !f.isImage);

  // Construir mensaje del sistema
  const shouldIncludeProjectContext = projectContext && projectContext.length > 0;
  let memoryContext = '';
  const isFirstMessage = messageIndex === 1; // Si el mensaje a regenerar es el primero del asistente

  if (isFirstMessage) {
    memoryContext = buildMemoryContext() || '';
  }

  if (isFirstMessage || shouldIncludeProjectContext || window._studyModeActive || window._webSearchModeActive || window._travelModeActive || window._healthModeActive) {
    let systemContent = '';

    if (projectContext) {
      systemContent += projectContext + '\n\n';
    }

    if (isFirstMessage) {
      if (memoryContext) {
        systemContent += memoryContext + '\n\n';
      }

      if (personalInfo.trim()) {
        systemContent += `Información personal del usuario: ${personalInfo.trim()}\n\n`;
      }
    }

    if (textFiles.length > 0) {
      systemContent += '=== DOCUMENTOS ADJUNTOS AL CHAT (DEBES LEER Y USAR ESTE CONTENIDO) ===\n\n';
      textFiles.forEach((file, index) => {
        systemContent += `══════════════════════════════════════════════════════════════\n`;
        systemContent += `📄 DOCUMENTO ${index + 1}: ${file.name}\n`;
        systemContent += `══════════════════════════════════════════════════════════════\n\n`;
        systemContent += `${file.content}\n\n`;
      });
      systemContent += '=== FIN DE DOCUMENTOS ADJUNTOS ===\n\n';
    }

    const responseStyle = getAIResponseStyle();
    const styleInstructions = getStyleInstructions(responseStyle);

    // Instrucciones especiales para modo estudio
    const studyModeInstructions = window._studyModeActive ? `
IMPORTANTE: Estás en MODO TUTOR SOCRÁTICO. Aplica estas reglas en tu respuesta:

Tu forma de enseñar:
- Responde con MÁXIMO 200 palabras
- NO des la respuesta completa directamente
- Guía al estudiante con preguntas que le hagan pensar
- Da una breve introducción al concepto (2-3 frases máximo)
- Termina SIEMPRE con preguntas que inviten a reflexionar

Estructura tu respuesta así:
1. Explicación breve del **concepto clave** 
2. Una analogía o ejemplo si ayuda
3. Termina con 1-2 preguntas para que el estudiante explore por su cuenta

NO expliques estas instrucciones al usuario. Simplemente responde siguiendo este método.

Ejemplo: Si te preguntan sobre regularización, explica brevemente qué es el **sobreajuste**, luego pregunta: "¿Qué camino prefieres: entender el problema primero, ver las soluciones técnicas, o explorar la intuición detrás del concepto?"
` : '';

    // Instrucciones y contexto para modo búsqueda web
    const webSearchInstructions = window._webSearchModeActive && window._webSearchContext ? `
🌐 MODO BÚSQUEDA WEB ACTIVADO

He realizado una búsqueda en internet sobre la consulta del usuario. Aquí están los resultados que encontré:

${window._webSearchContext}

INSTRUCCIONES:
1. Usa esta información de internet para responder la pregunta del usuario de manera completa y precisa.
2. Sintetiza la información de múltiples fuentes cuando sea relevante.
3. Si citas información específica, menciona de qué fuente proviene.
4. Si la información parece desactualizada o contradictoria, indícalo.
5. Complementa con tu conocimiento cuando sea apropiado.
6. Al final, puedes sugerir búsquedas adicionales si el usuario quiere profundizar.
` : '';

    let instructions = '';
    const hasDocuments = textFiles.length > 0 || shouldIncludeProjectContext;
    const hasPersonalContext = personalInfo.trim() || memoryContext;

    if (hasDocuments) {
      instructions = 'IMPORTANTE: Se te han proporcionado documentos arriba. DEBES leer y usar el contenido de estos documentos para responder las preguntas del usuario.';
    } else if (hasPersonalContext) {
      instructions = 'Ten en cuenta esta información sobre el usuario al responder sus preguntas.';
    }

    if (systemContent || styleInstructions || instructions || studyModeInstructions || webSearchInstructions) {
      let finalContent = systemContent;

      // Añadir contexto de búsqueda web primero (máxima prioridad)
      if (webSearchInstructions) {
        if (finalContent) {
          finalContent += '\n\n';
        }
        finalContent += webSearchInstructions;
        console.log('🌐 Modo Web activado - Añadiendo resultados de búsqueda');
      }

      // Añadir instrucciones del modo estudio (alta prioridad)
      if (studyModeInstructions) {
        if (finalContent) {
          finalContent += '\n\n';
        }
        finalContent += studyModeInstructions;
        console.log('📚 Modo Estudio activado - Añadiendo instrucciones de tutor');
      }

      if (styleInstructions && !studyModeInstructions) {
        // Solo añadir estilo si no está en modo estudio (el modo estudio tiene su propio estilo)
        if (finalContent) finalContent += '\n';
        finalContent += `Instrucciones de estilo de respuesta: ${styleInstructions}`;
      }

      if (instructions) {
        if (finalContent) finalContent += '\n\n';
        finalContent += instructions;
      }

      // Añadir instrucciones de viajes si está activo
      if (window._travelModeActive) {
        const travelInstructions = window.travelMode?.getSystemPrompt ? window.travelMode.getSystemPrompt() : `
Cuando el usuario pregunte sobre lugares, viajes, o qué hacer en algún sitio, usa estos comandos especiales:

PARA MOSTRAR LUGARES EN UN MAPA:
[TRAVEL_MAP]
[PLACE:Nombre del lugar|latitud|longitud|categoría|descripción|valoración]
[/TRAVEL_MAP]

Ejemplo:
[TRAVEL_MAP]
[PLACE:Arena de Nimes|43.8362|4.3601|Monumento|Anfiteatro romano|4.6]
[/TRAVEL_MAP]
`;
        if (finalContent) finalContent += '\n\n';
        finalContent += travelInstructions;
        console.log('🗺️ Modo Viajes activado - Instrucciones de mapa añadidas');
      }

      // Instrucciones para Modo Salud
      if (window._healthModeActive) {
        const healthInstructions = window.healthMode?.getSystemPrompt ? window.healthMode.getSystemPrompt() : '🏥 MODO SALUD ACTIVADO. Responde como un coach de bienestar integral.';
        if (finalContent) finalContent += '\n\n';
        finalContent += healthInstructions;
        console.log('🏥 Modo Salud activado - Instrucciones de salud añadidas');
      }

      if (finalContent.trim()) {
        payloadMessages.push({
          role: 'system',
          content: finalContent.trim()
        });
      }
    }
  }

  // Añadir los mensajes de la conversación (hasta el mensaje del usuario)
  for (let i = 0; i <= userMessageIndex; i++) {
    const message = conversation.messages[i];
    const payloadMessage = {
      role: message.role,
      content: message.content || '',
    };

    // Solo añadir imágenes al último mensaje del usuario
    const isLastUserMessage = message.role === 'user' && i === userMessageIndex && imageFiles.length > 0;

    if (isLastUserMessage) {
      payloadMessage.images = imageFiles.map(file => {
        if (file.content && file.content.startsWith('data:')) {
          return file.content.split(',')[1];
        }
        return file.content;
      }).filter(img => img !== null);
    }

    payloadMessages.push(payloadMessage);
  }

  state.loading = true;

  try {
    await streamAssistantResponse(conversation, payloadMessages);
  } catch (error) {
    console.error(error);
    const assistantMessage = conversation.messages[conversation.messages.length - 1];
    if (assistantMessage?.role === 'assistant') {
      if (error.name !== 'AbortError' && !error.message.includes('cancel')) {
        assistantMessage.content = `⚠️ ${error.message}`;
        const lastBubble = chatListElement?.lastElementChild?.querySelector('.message-bubble');
        updateAssistantBubble(lastBubble, assistantMessage.content);
        persistState();
      }
    }
  } finally {
    state.loading = false;
    currentStreamReader = null;
    updateStopButtonToSend();
  }
}

function updateSendButtonToStop() {
  const sendButtons = document.querySelectorAll('.send-button');

  sendButtons.forEach(button => {
    button.textContent = '■';
    button.title = 'Detener';
    button.classList.add('stop-button');
    button.type = 'button'; // Cambiar a button para evitar submit
    button.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      stopStream();
    };
  });
}

function updateStopButtonToSend() {
  const sendButtons = document.querySelectorAll('.send-button');

  sendButtons.forEach(button => {
    button.textContent = '↑';
    button.title = 'Enviar';
    button.classList.remove('stop-button');
    button.type = 'submit'; // Volver a submit
    button.onclick = null;
  });
}

let handleSubmit = async function handleSubmitOriginal(event) {
  event.preventDefault();
  if (state.loading) return;

  const isEmptyState = emptyState?.style.display !== 'none';

  // Buscar el input que tenga contenido (más robusto)
  let activeInput = isEmptyState ? promptInput : promptInputInline;
  let prompt = activeInput?.value.trim();

  // Si el input seleccionado está vacío, intentar con el otro
  if (!prompt) {
    const otherInput = isEmptyState ? promptInputInline : promptInput;
    const otherPrompt = otherInput?.value.trim();
    if (otherPrompt) {
      activeInput = otherInput;
      prompt = otherPrompt;
    }
  }

  if (!prompt) return;

  const conversation = state.conversations[state.activeId];
  if (!conversation) return;
  const wantsCanvas = canvasMode || detectCanvasIntent(prompt);
  let activeCanvasDoc = getCanvasDoc(conversation.id);
  if (wantsCanvas && !activeCanvasDoc) {
    activeCanvasDoc = ensureCanvasDoc(conversation.id);
  }

  state.loading = true;
  activeInput.value = '';
  autoResizeTextarea(activeInput);

  // Obtener archivos adjuntos de la conversación actual
  const currentFiles = attachedFiles[conversation.id] || [];
  const userMessage = createMessage('user', prompt, currentFiles);
  conversation.messages.push(userMessage);
  touchConversation(conversation.id);

  if (isEmptyState) {
    showChatState();
  }

  appendMessageElement(userMessage);

  updateConversationTitleFromContent(conversation);

  // Sincronizar UI con el nuevo título inmediatamente
  const conversationTitle = document.getElementById('conversation-title');
  if (conversationTitle) {
    conversationTitle.textContent = conversation.title;
  }

  conversation.updatedAt = Date.now();
  persistState();
  renderConversationList();

  // Construir mensajes incluyendo el contexto de archivos adjuntos
  const payloadMessages = [];

  // Agregar información personal del usuario como contexto del sistema (solo en el primer mensaje)
  const isFirstMessage = conversation.messages.length === 1;
  const personalInfo = getAIPersonalization();

  // Obtener contexto del proyecto activo
  const activeProject = getActiveProject();
  const projectContext = activeProject ? buildProjectContext(activeProject) : '';

  // Log de depuración para proyecto activo
  if (activeProject) {
    console.log('📂 Proyecto activo:', activeProject.name);
    console.log(`   - Archivos en proyecto: ${activeProject.files?.length || 0}`);
    const projectTextFiles = (activeProject.files || []).filter(f => !f.isImage);
    projectTextFiles.forEach(f => {
      console.log(`   📄 ${f.name}: ${f.content?.length || 0} caracteres`);
    });
    console.log(`   - Contexto del proyecto: ${projectContext.length} caracteres totales`);
  }

  // Si hay archivos adjuntos, añadir el contexto al primer mensaje del usuario
  // Solo añadir el contexto una vez al inicio de la conversación con archivos
  const hasFiles = attachedFiles[conversation.id] && attachedFiles[conversation.id].length > 0;
  const isFirstMessageWithFiles = hasFiles && conversation.messages.length === 1;

  // Separar imágenes de otros archivos
  const imageFiles = hasFiles ? attachedFiles[conversation.id].filter(f => f.isImage) : [];
  const textFiles = hasFiles ? attachedFiles[conversation.id].filter(f => !f.isImage) : [];

  // Log de depuración para archivos adjuntos al chat
  if (hasFiles) {
    console.log('📎 Archivos adjuntos al chat:');
    console.log(`   - Imágenes: ${imageFiles.length}`);
    console.log(`   - Archivos de texto/PDF: ${textFiles.length}`);
    textFiles.forEach(f => {
      console.log(`   📄 ${f.name}: ${f.content?.length || 0} caracteres`);
    });
  }

  // Construir mensaje del sistema combinando proyecto, información personal, estilo, memorias y archivos
  // NOTA: Para proyectos, SIEMPRE enviamos el contexto ya que los archivos son persistentes
  const shouldIncludeProjectContext = projectContext && projectContext.length > 0;

  // Variables para contexto adicional
  let memoryContext = '';
  if (isFirstMessage) {
    memoryContext = buildMemoryContext() || '';
  }

  // Si es el primer mensaje O hay un proyecto activo O un modo especial está activo, construir el mensaje del sistema
  if (isFirstMessage || shouldIncludeProjectContext || window._studyModeActive || window._webSearchModeActive || window._travelModeActive || window._healthModeActive) {
    let systemContent = '';

    // PRIMERO: Agregar contexto del proyecto (máxima prioridad) - SIEMPRE si hay proyecto
    if (projectContext) {
      systemContent += projectContext + '\n\n';
      console.log('📂 Contexto del proyecto incluido en el mensaje del sistema');
    }

    // Agregar memorias e info personal (solo en primer mensaje)
    if (isFirstMessage) {
      if (memoryContext) {
        systemContent += memoryContext + '\n\n';
      }

      if (personalInfo.trim()) {
        systemContent += `Información personal del usuario: ${personalInfo.trim()}\n\n`;
      }
    }

    // Agregar contexto de archivos adjuntos al chat si existen
    if (textFiles.length > 0) {
      systemContent += '=== DOCUMENTOS ADJUNTOS AL CHAT (DEBES LEER Y USAR ESTE CONTENIDO) ===\n\n';
      textFiles.forEach((file, index) => {
        const totalChars = file.content?.length || 0;
        console.log(`📄 Incluyendo archivo del chat ${index + 1}: ${file.name} (${totalChars} caracteres)`);
        systemContent += `══════════════════════════════════════════════════════════════\n`;
        systemContent += `📄 DOCUMENTO ${index + 1}: ${file.name}\n`;
        systemContent += `══════════════════════════════════════════════════════════════\n\n`;
        systemContent += `${file.content}\n\n`;
      });
      systemContent += '=== FIN DE DOCUMENTOS ADJUNTOS ===\n\n';
    }

    // Agregar instrucciones del estilo de respuesta
    const responseStyle = getAIResponseStyle();
    const styleInstructions = getStyleInstructions(responseStyle);

    // Instrucciones especiales para modo estudio
    const studyModeInstructions = window._studyModeActive ? `
IMPORTANTE: Estás en MODO TUTOR SOCRÁTICO. Aplica estas reglas en tu respuesta:

Tu forma de enseñar:
- Responde con MÁXIMO 200 palabras
- NO des la respuesta completa directamente
- Guía al estudiante con preguntas que le hagan pensar
- Da una breve introducción al concepto (2-3 frases máximo)
- Termina SIEMPRE con preguntas que inviten a reflexionar

Estructura tu respuesta así:
1. Explicación breve del **concepto clave** 
2. Una analogía o ejemplo si ayuda
3. Termina con 1-2 preguntas para que el estudiante explore por su cuenta

NO expliques estas instrucciones al usuario. Simplemente responde siguiendo este método.

Ejemplo: Si te preguntan sobre regularización, explica brevemente qué es el **sobreajuste**, luego pregunta: "¿Qué camino prefieres: entender el problema primero, ver las soluciones técnicas, o explorar la intuición detrás del concepto?"
` : '';

    // Instrucciones y contexto para modo búsqueda web
    const webSearchInstructions = window._webSearchModeActive && window._webSearchContext ? `
🌐 MODO BÚSQUEDA WEB ACTIVADO

He realizado una búsqueda en internet sobre la consulta del usuario. Aquí están los resultados que encontré:

${window._webSearchContext}

INSTRUCCIONES:
1. Usa esta información de internet para responder la pregunta del usuario de manera completa y precisa.
2. Sintetiza la información de múltiples fuentes cuando sea relevante.
3. Si citas información específica, menciona de qué fuente proviene.
4. Si la información parece desactualizada o contradictoria, indícalo.
5. Complementa con tu conocimiento cuando sea apropiado.
6. Al final, puedes sugerir búsquedas adicionales si el usuario quiere profundizar.
` : '';

    // Determinar las instrucciones finales
    let instructions = '';
    const hasDocuments = textFiles.length > 0 || shouldIncludeProjectContext;
    const hasPersonalContext = personalInfo.trim() || memoryContext;

    if (hasDocuments) {
      instructions = 'IMPORTANTE: Se te han proporcionado documentos arriba. DEBES leer y usar el contenido de estos documentos para responder las preguntas del usuario. Responde basándote en la información de los documentos. Si el usuario pregunta sobre el contenido de los documentos, resume o explica lo que contienen.';
    } else if (hasPersonalContext) {
      instructions = 'Ten en cuenta esta información sobre el usuario al responder sus preguntas y proporciona respuestas más personalizadas cuando sea relevante.';
    }

    // Combinar todas las instrucciones
    if (systemContent || styleInstructions || instructions || studyModeInstructions || webSearchInstructions) {
      let finalContent = systemContent;

      // Añadir instrucciones del modo estudio primero (alta prioridad)

      // Añadir contexto de búsqueda web primero (máxima prioridad)
      if (webSearchInstructions) {
        if (finalContent) {
          finalContent += '\n\n';
        }
        finalContent += webSearchInstructions;
        console.log('🌐 Modo Web activado - Añadiendo resultados de búsqueda');
      }

      // Añadir instrucciones del modo estudio (alta prioridad)
      if (studyModeInstructions) {
        if (finalContent) {
          finalContent += '\n\n';
        }
        finalContent += studyModeInstructions;
        console.log('📚 Modo Estudio activado - Añadiendo instrucciones de tutor');
      }

      if (styleInstructions && !studyModeInstructions) {
        // Solo añadir estilo si no está en modo estudio (el modo estudio tiene su propio estilo)
        if (finalContent) {
          finalContent += '\n';
        }
        finalContent += `Instrucciones de estilo de respuesta: ${styleInstructions}`;
      }

      if (instructions) {
        if (finalContent) {
          finalContent += '\n\n';
        }
        finalContent += instructions;
      }

      if (wantsCanvas) {
        const canvasMsg = buildCanvasInstruction(activeCanvasDoc, prompt);
        if (canvasMsg) {
          if (finalContent) finalContent += '\n\n';
          finalContent += canvasMsg;
        }
      }

      // Instrucciones para modo música
      const wantsMusic = window._musicModeActive;
      if (wantsMusic) {
        const musicMsg = `MODO MÚSICA: Responde SIEMPRE con este formato:
[ABC]
X:1
T:Nombre
M:4/4
L:1/4
Q:1/4=120
K:C
C D E F | G A B c |
[/ABC]
Luego explica.`;
        if (finalContent) finalContent += '\n\n';
        finalContent += musicMsg;
        console.log('🎵 Modo Música activado - Instrucciones [ABC] añadidas');
      }

      // Instrucciones para Score Canvas (partitura colaborativa)
      const scoreCanvasActive = scoreCanvasMode || (state.activeId && getScoreDoc(state.activeId));
      if (scoreCanvasActive) {
        const scoreInstruction = buildScoreInstruction(state.activeId, prompt);
        if (scoreInstruction) {
          if (finalContent) finalContent += '\n\n';
          finalContent += scoreInstruction;
          console.log('🎼 Score Canvas activo - Instrucciones de partitura colaborativa añadidas');
        }
      }

      // Instrucciones para Modo Viajes
      const travelModeActive = window._travelModeActive;
      if (travelModeActive) {
        const travelInstructions = window.travelMode?.getSystemPrompt ? window.travelMode.getSystemPrompt() : `
Cuando el usuario pregunte sobre lugares, viajes, o qué hacer en algún sitio, usa estos comandos especiales:

PARA MOSTRAR LUGARES EN UN MAPA:
[TRAVEL_MAP]
[PLACE:Nombre del lugar|latitud|longitud|categoría|descripción|valoración]
[PLACE:Otro lugar|latitud|longitud|categoría|descripción|valoración]
[/TRAVEL_MAP]

PARA GENERAR ENLACE DE RUTA:
Usa [GMAPS_ROUTE] después de mostrar lugares para generar un enlace de Google Maps.

Ejemplo:
[TRAVEL_MAP]
[PLACE:Arena de Nimes|43.8362|4.3601|Monumento|Anfiteatro romano del siglo I|4.6]
[PLACE:Jardin de La Fontaine|43.8375|4.3536|Parque|Jardín histórico con ruinas|4.7]
[/TRAVEL_MAP]

No menciones estos comandos al usuario, simplemente úsalos. El sistema los convertirá en mapas interactivos.
`;
        if (finalContent) finalContent += '\n\n';
        finalContent += travelInstructions;
        console.log('🗺️ Modo Viajes activado - Instrucciones de mapa añadidas');
      }

      // Instrucciones para Modo Salud
      if (window._healthModeActive) {
        const healthInstructions = window.healthMode?.getSystemPrompt ? window.healthMode.getSystemPrompt() : '🏥 MODO SALUD ACTIVADO. Responde como un coach de bienestar integral.';
        if (finalContent) finalContent += '\n\n';
        finalContent += healthInstructions;
        console.log('🏥 Modo Salud activado - Instrucciones de salud añadidas');
      }

      if (finalContent.trim()) {
        payloadMessages.push({
          role: 'system',
          content: finalContent.trim()
        });

        // Log de depuración del mensaje del sistema
        console.log('📋 Mensaje del sistema enviado:');
        console.log(`   - Longitud total: ${finalContent.length} caracteres`);
        console.log(`   - Primeros 500 chars: ${finalContent.substring(0, 500)}...`);
        if (finalContent.length > 10000) {
          console.warn('⚠️ El contexto es muy largo (>10000 chars). Algunos modelos locales pueden tener problemas.');
        }
      }
    }
  } else if (textFiles.length > 0) {
    // Para mensajes posteriores SIN proyecto, añadir el contexto de archivos al mensaje del usuario actual
    let contextContent = '=== DOCUMENTOS ADJUNTOS (USA ESTE CONTENIDO PARA RESPONDER) ===\n\n';
    textFiles.forEach((file, index) => {
      contextContent += `══════════════════════════════════════════════════════════════\n`;
      contextContent += `📄 DOCUMENTO ${index + 1}: ${file.name}\n`;
      contextContent += `══════════════════════════════════════════════════════════════\n\n`;
      contextContent += `${file.content}\n\n`;
    });
    contextContent += '=== FIN DE DOCUMENTOS ===\n\n';
    const lastUserMessage = conversation.messages[conversation.messages.length - 1];
    if (lastUserMessage && lastUserMessage.role === 'user') {
      lastUserMessage.content = contextContent + '\n\nPregunta del usuario: ' + lastUserMessage.content;
    }
  }

  // Añadir los mensajes de la conversación
  conversation.messages.forEach((message, index) => {
    const payloadMessage = {
      role: message.role,
      content: message.content || '', // Asegurar que siempre haya contenido (aunque sea vacío)
    };

    // Solo añadir imágenes al último mensaje del usuario (el mensaje actual)
    const isLastUserMessage = message.role === 'user' &&
      index === conversation.messages.length - 1 &&
      imageFiles.length > 0;

    if (isLastUserMessage) {
      // Extraer solo el base64 sin el prefijo data:image/...
      payloadMessage.images = imageFiles.map(file => {
        // El contenido ya viene como data:image/...;base64,... así que extraemos solo la parte base64
        if (file.content && file.content.startsWith('data:')) {
          const base64Part = file.content.split(',')[1]; // Extraer solo la parte después de la coma
          console.log(`Imagen ${file.name}: base64 length = ${base64Part ? base64Part.length : 0}`);

          // Validar que el base64 no esté vacío
          if (!base64Part || base64Part.length === 0) {
            console.error(`Error: La imagen ${file.name} tiene base64 vacío`);
            return null;
          }

          return base64Part;
        }
        console.warn(`Imagen ${file.name} no tiene formato data: correcto`);
        return file.content;
      }).filter(img => img !== null); // Filtrar imágenes nulas

      console.log(`Añadidas ${payloadMessage.images.length} imagen(es) al mensaje del usuario`);

      // Si no hay contenido de texto pero hay imágenes, agregar un prompt por defecto
      if (!payloadMessage.content.trim() && payloadMessage.images.length > 0) {
        payloadMessage.content = 'Describe esta imagen';
        console.log('No hay texto en el mensaje, agregando prompt por defecto');
      }
    }

    payloadMessages.push(payloadMessage);
  });

  if (wantsCanvas) {
    const alreadyHasCanvasInstruction = payloadMessages.some(m => m.role === 'system' && m.content?.includes('"type": "canvas"'));
    if (!alreadyHasCanvasInstruction) {
      payloadMessages.unshift({
        role: 'system',
        content: buildCanvasInstruction(activeCanvasDoc, prompt)
      });
    }
  }

  try {
    await streamAssistantResponse(conversation, payloadMessages);
  } catch (error) {
    console.error(error);
    const assistantMessage = conversation.messages[conversation.messages.length - 1];
    if (assistantMessage?.role === 'assistant') {
      // Solo mostrar error si no fue cancelado por el usuario
      if (error.name !== 'AbortError' && !error.message.includes('cancel')) {
        assistantMessage.content = `⚠️ ${error.message}`;
        const lastBubble = chatList?.lastElementChild?.querySelector('.message-bubble');
        updateAssistantBubble(lastBubble, assistantMessage.content);
        persistState();
      }
    }
  } finally {
    state.loading = false;
    currentStreamReader = null;
    updateStopButtonToSend();
  }
}

function handleQuickActionClick(event) {
  const value = event.currentTarget?.dataset?.suggestion;
  if (!value) return;
  const isEmptyState = emptyState?.style.display !== 'none';
  const activeInput = isEmptyState ? promptInput : promptInputInline;
  if (!activeInput) return;
  activeInput.value = value;
  autoResizeTextarea(activeInput);
  activeInput.focus();
}

function toggleConversationList() {
  if (!conversationSection) return;
  const collapsed = conversationSection.classList.toggle('collapsed');
  if (collapseConversationsButton) {
    collapseConversationsButton.textContent = collapsed ? '△' : '▽';
  }
}

function handleKeyDown(event, form) {
  // Enter sin Shift = enviar
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  }
  // Shift+Enter = nueva línea (comportamiento por defecto del textarea)
}

// Funciones para manejar archivos
async function readFileAsText(file) {
  return new Promise(async (resolve, reject) => {
    // Para archivos muy grandes (>5MB), procesar en chunks
    const MAX_SYNC_SIZE = 5 * 1024 * 1024; // 5MB

    if (file.size > MAX_SYNC_SIZE) {
      // Procesar archivos grandes de forma asíncrona
      try {
        const text = await file.text();
        // Dar tiempo al navegador después de leer archivos grandes
        await yieldToBrowser();
        resolve(text);
      } catch (error) {
        reject(new Error('Error al leer el archivo grande'));
      }
    } else {
      // Archivos pequeños: procesamiento normal
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = (e) => reject(new Error('Error al leer el archivo'));
      reader.readAsText(file);
    }
  });
}

// Función para esperar a que pdf.js esté cargado
async function waitForPdfJs(maxAttempts = 50) {
  for (let i = 0; i < maxAttempts; i++) {
    if (typeof pdfjsLib !== 'undefined') {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return false;
}

// Función auxiliar para dar tiempo al navegador entre operaciones pesadas
function yieldToBrowser() {
  return new Promise(resolve => {
    // Usar requestIdleCallback si está disponible, sino setTimeout
    if (window.requestIdleCallback) {
      requestIdleCallback(() => resolve(), { timeout: 50 });
    } else {
      setTimeout(() => resolve(), 10);
    }
  });
}

// Función para extraer texto de un PDF con procesamiento incremental
async function extractTextFromPDF(file, progressCallback) {
  return new Promise(async (resolve, reject) => {
    try {
      // Esperar a que pdf.js esté cargado
      const isLoaded = await waitForPdfJs();
      if (!isLoaded) {
        reject(new Error('La biblioteca PDF.js no está cargada. Por favor, recarga la página.'));
        return;
      }

      // Configurar el worker de PDF.js
      if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      }

      // Leer el archivo como ArrayBuffer
      const arrayBuffer = await file.arrayBuffer();

      // Cargar el documento PDF
      const loadingTask = pdfjsLib.getDocument({
        data: arrayBuffer,
        useSystemFonts: true
      });
      const pdf = await loadingTask.promise;

      let fullText = '';
      const numPages = pdf.numPages;

      // Extraer texto de cada página con pausas para no bloquear el navegador
      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        // Dar tiempo al navegador cada página
        await yieldToBrowser();

        // Actualizar progreso si hay callback
        if (progressCallback) {
          progressCallback(pageNum, numPages);
        }

        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();

        // Concatenar el texto de la página, preservando saltos de línea cuando sea apropiado
        const pageText = textContent.items
          .map((item, index, array) => {
            const text = item.str;
            // Si el siguiente item está en una posición muy diferente, probablemente es una nueva línea
            if (index < array.length - 1) {
              const nextItem = array[index + 1];
              const currentY = item.transform[5];
              const nextY = nextItem.transform[5];
              // Si hay una diferencia significativa en Y, agregar salto de línea
              if (Math.abs(currentY - nextY) > item.height * 0.5) {
                return text + '\n';
              }
            }
            return text;
          })
          .join(' ');

        fullText += `\n--- Página ${pageNum} de ${numPages} ---\n${pageText}\n`;

        // Pausa adicional cada 5 páginas para archivos muy grandes
        if (pageNum % 5 === 0) {
          await yieldToBrowser();
        }
      }

      if (!fullText.trim()) {
        reject(new Error('No se pudo extraer texto del PDF. El archivo podría estar escaneado (solo imágenes) o protegido con contraseña.'));
        return;
      }

      resolve(fullText.trim());
    } catch (error) {
      console.error('Error al extraer texto del PDF:', error);

      // Mensajes de error más específicos
      let errorMessage = 'Error al leer el PDF';
      if (error.message.includes('password') || error.message.includes('encrypted')) {
        errorMessage = 'El PDF está protegido con contraseña y no se puede leer.';
      } else if (error.message.includes('Invalid PDF')) {
        errorMessage = 'El archivo PDF está dañado o no es válido.';
      } else {
        errorMessage = `Error al leer el PDF: ${error.message}`;
      }

      reject(new Error(errorMessage));
    }
  });
}

// Función para convertir imagen a base64
async function convertImageToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      // El resultado ya incluye el prefijo data:image/...
      resolve(e.target.result);
    };
    reader.onerror = (e) => reject(new Error('Error al leer la imagen'));
    reader.readAsDataURL(file);
  });
}

// Función para verificar si un archivo es una imagen
function isImageFile(file) {
  const imageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
  const fileName = file.name.toLowerCase();

  return imageTypes.includes(file.type) ||
    imageExtensions.some(ext => fileName.endsWith(ext));
}

// Función unificada para leer archivos (texto, PDF o imagen)
async function readFileContent(file) {
  const isPDF = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  const isImage = isImageFile(file);

  if (isImage) {
    // Para imágenes, devolvemos el base64 directamente
    return await convertImageToBase64(file);
  } else if (isPDF) {
    // Para PDFs, devolvemos tanto el texto extraído como el binario
    const textContent = await extractTextFromPDF(file, null);
    const binaryContent = await convertFileToBase64(file);
    return { text: textContent, binary: binaryContent, isPdfData: true };
  } else {
    return await readFileAsText(file);
  }
}

// Convierte un archivo a base64 data URL
async function convertFileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });
}

// Función para crear y mostrar indicador de progreso
function createProgressIndicator(fileName) {
  const progressDiv = document.createElement('div');
  progressDiv.className = 'file-progress-indicator';
  progressDiv.innerHTML = `
    <div class="file-progress-content">
      <div class="file-progress-spinner"></div>
      <div class="file-progress-text">
        <div class="file-progress-name">${escapeHtml(fileName)}</div>
        <div class="file-progress-status">Procesando...</div>
      </div>
    </div>
  `;

  // Agregar al área de archivos
  const isEmptyState = emptyState?.style.display !== 'none';
  const fileList = isEmptyState
    ? document.getElementById('file-list')
    : document.getElementById('file-list-inline');

  if (fileList) {
    fileList.appendChild(progressDiv);
  }

  return {
    update: (current, total) => {
      const statusEl = progressDiv.querySelector('.file-progress-status');
      if (statusEl) {
        if (total > 1) {
          statusEl.textContent = `Procesando página ${current} de ${total}...`;
        } else {
          statusEl.textContent = 'Procesando...';
        }
      }
    },
    complete: () => {
      progressDiv.remove();
    },
    error: (message) => {
      const statusEl = progressDiv.querySelector('.file-progress-status');
      if (statusEl) {
        statusEl.textContent = `Error: ${message}`;
        statusEl.style.color = '#e74c3c';
      }
      setTimeout(() => progressDiv.remove(), 3000);
    }
  };
}

async function handleFiles(files, isInline = false) {
  if (!state.activeId) return;

  const fileArray = Array.from(files);
  const conversationId = state.activeId;

  // Límites de tamaño
  const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
  const MAX_PDF_PAGES = 500; // Límite de páginas para PDFs

  if (!attachedFiles[conversationId]) {
    attachedFiles[conversationId] = [];
  }

  // Procesar archivos uno por uno con pausas entre ellos
  for (let i = 0; i < fileArray.length; i++) {
    const file = fileArray[i];

    try {
      // Verificar tamaño del archivo
      if (file.size > MAX_FILE_SIZE) {
        alert(window.translationManager
          ? window.translationManager.translate('error.fileTooLarge', { name: file.name, size: formatFileSize(file.size), maxSize: formatFileSize(MAX_FILE_SIZE) })
          : `El archivo ${file.name} es demasiado grande (${formatFileSize(file.size)}). El tamaño máximo es ${formatFileSize(MAX_FILE_SIZE)}.`);
        continue;
      }

      const isPDF = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      const isImage = isImageFile(file);

      // Crear indicador de progreso
      const progress = createProgressIndicator(file.name);

      if (isPDF) {
        console.log(`Procesando PDF: ${file.name}...`);

        // Verificar número de páginas antes de procesar
        try {
          const isLoaded = await waitForPdfJs();
          if (isLoaded) {
            const arrayBuffer = await file.arrayBuffer();
            const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
            const pdf = await loadingTask.promise;

            if (pdf.numPages > MAX_PDF_PAGES) {
              progress.error(`El PDF tiene demasiadas páginas (${pdf.numPages}). El máximo es ${MAX_PDF_PAGES} páginas.`);
              alert(window.translationManager
                ? window.translationManager.translate('error.pdfTooManyPages', { name: file.name, pages: pdf.numPages, maxPages: MAX_PDF_PAGES })
                : `El PDF ${file.name} tiene demasiadas páginas (${pdf.numPages}). El máximo permitido es ${MAX_PDF_PAGES} páginas.`);
              continue;
            }
          }
        } catch (e) {
          // Si falla la verificación, continuar de todos modos
        }

        // Procesar PDF con callback de progreso
        const content = await extractTextFromPDF(file, (current, total) => {
          progress.update(current, total);
        });

        attachedFiles[conversationId].push({
          id: generateId('file'),
          name: file.name,
          size: file.size,
          type: file.type,
          content: content,
          isImage: false,
          uploadedAt: Date.now()
        });

        progress.complete();
        console.log(`Archivo ${file.name} procesado correctamente`);
      } else if (isImage) {
        console.log(`Procesando imagen: ${file.name}...`);
        const content = await readFileContent(file);
        attachedFiles[conversationId].push({
          id: generateId('file'),
          name: file.name,
          size: file.size,
          type: file.type,
          content: content,
          isImage: true,
          uploadedAt: Date.now()
        });
        progress.complete();
        console.log(`Archivo ${file.name} procesado correctamente`);
      } else {
        console.log(`Procesando archivo de texto: ${file.name}...`);
        const content = await readFileContent(file);
        attachedFiles[conversationId].push({
          id: generateId('file'),
          name: file.name,
          size: file.size,
          type: file.type,
          content: content,
          isImage: false,
          uploadedAt: Date.now()
        });
        progress.complete();
        console.log(`Archivo ${file.name} procesado correctamente`);
      }

      // Pausa entre archivos para no sobrecargar el navegador
      if (i < fileArray.length - 1) {
        await yieldToBrowser();
      }
    } catch (error) {
      console.error(`Error al leer el archivo ${file.name}:`, error);
      let errorMessage;
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        errorMessage = `Error al leer el PDF ${file.name}: ${error.message}`;
      } else if (isImageFile(file)) {
        errorMessage = `Error al leer la imagen ${file.name}: ${error.message}`;
      } else {
        errorMessage = `Error al leer el archivo ${file.name}: ${error.message}`;
      }
      alert(errorMessage);
    }
  }

  renderAttachedFiles();
}

function removeFile(fileId) {
  if (!state.activeId) return;
  const conversationId = state.activeId;

  if (attachedFiles[conversationId]) {
    attachedFiles[conversationId] = attachedFiles[conversationId].filter(f => f.id !== fileId);
    renderAttachedFiles();
    // Actualizar el dropdown si está abierto
    const dropdown = document.getElementById('attachments-dropdown');
    if (dropdown && dropdown.style.display !== 'none') {
      showAttachmentsDropdown();
    }
  }
}

function renderAttachedFiles() {
  if (!state.activeId) return;

  const conversationId = state.activeId;
  const files = attachedFiles[conversationId] || [];

  const isEmptyState = emptyState?.style.display !== 'none';
  const fileList = isEmptyState
    ? document.getElementById('file-list')
    : document.getElementById('file-list-inline');
  const fileDropArea = isEmptyState
    ? document.getElementById('file-drop-area')
    : document.getElementById('file-drop-area-inline');

  if (!fileList || !fileDropArea) return;

  fileList.innerHTML = '';

  if (files.length > 0) {
    fileDropArea.classList.add('has-files');

    files.forEach(file => {
      const fileItem = document.createElement('div');
      fileItem.className = 'file-item';

      // Si es una imagen, mostrar miniatura
      if (file.isImage && file.content) {
        const imagePreview = document.createElement('img');
        imagePreview.src = file.content;
        imagePreview.className = 'file-item-image';
        imagePreview.alt = file.name;
        imagePreview.title = file.name;
        fileItem.appendChild(imagePreview);
      }

      const fileName = document.createElement('span');
      fileName.className = 'file-item-name';
      fileName.textContent = file.name;
      fileName.title = file.name;

      const removeBtn = document.createElement('button');
      removeBtn.className = 'file-item-remove';
      removeBtn.textContent = '×';
      removeBtn.title = 'Eliminar archivo';
      removeBtn.onclick = () => removeFile(file.id);

      fileItem.appendChild(fileName);
      fileItem.appendChild(removeBtn);
      fileList.appendChild(fileItem);
    });
  } else {
    fileDropArea.classList.remove('has-files');
  }

  // Actualizar badge de archivos en el header
  updateAttachmentsBadge();
}

function updateAttachmentsBadge() {
  if (!state.activeId) return;

  const conversationId = state.activeId;
  const files = attachedFiles[conversationId] || [];
  const badge = document.getElementById('attachments-badge');
  const count = document.getElementById('attachments-count');

  if (badge && count) {
    if (files.length > 0) {
      count.textContent = files.length;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }
}

function showAttachmentsDropdown() {
  if (!state.activeId) return;

  const conversationId = state.activeId;
  const files = attachedFiles[conversationId] || [];
  const dropdown = document.getElementById('attachments-dropdown');
  const list = document.getElementById('attachments-list');

  if (!dropdown || !list) return;

  list.innerHTML = '';

  if (files.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'attachments-list-item';
    empty.style.justifyContent = 'center';
    empty.style.color = 'rgba(255, 255, 255, 0.5)';
    empty.textContent = 'No hay archivos adjuntos';
    list.appendChild(empty);
  } else {
    files.forEach(file => {
      const item = document.createElement('div');
      item.className = 'attachments-list-item';

      const fileExt = getFileExtension(file.name);
      const fileSize = formatFileSize(file.size);

      const icon = document.createElement('div');
      icon.className = 'attachments-list-item-icon';
      icon.textContent = fileExt;

      const info = document.createElement('div');
      info.className = 'attachments-list-item-info';

      const name = document.createElement('div');
      name.className = 'attachments-list-item-name';
      name.textContent = file.name;
      name.title = file.name;

      const size = document.createElement('div');
      size.className = 'attachments-list-item-size';
      size.textContent = fileSize;

      info.appendChild(name);
      info.appendChild(size);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'attachments-list-item-remove';
      removeBtn.textContent = '×';
      removeBtn.title = 'Eliminar archivo';
      removeBtn.onclick = (e) => {
        e.stopPropagation();
        removeFile(file.id);
      };

      item.appendChild(icon);
      item.appendChild(info);
      item.appendChild(removeBtn);
      list.appendChild(item);
    });
  }

  dropdown.style.display = 'flex';
}

function hideAttachmentsDropdown() {
  const dropdown = document.getElementById('attachments-dropdown');
  if (dropdown) {
    dropdown.style.display = 'none';
  }
}

function toggleSidebar() {
  if (!sidebar || !layout || !toggleSidebarButton) return;

  const isMinimized = sidebar.classList.toggle('minimized');
  layout.classList.toggle('sidebar-minimized', isMinimized);

  // Actualizar el título del botón
  toggleSidebarButton.title = isMinimized ? 'Expandir barra lateral' : 'Minimizar barra lateral';

  // Guardar el estado en localStorage
  if (hasLocalStorage) {
    try {
      localStorage.setItem('sidebar-minimized', JSON.stringify(isMinimized));
    } catch (error) {
      console.warn('No se pudo guardar el estado del sidebar', error);
    }
  }
}

function loadSidebarState() {
  if (!sidebar || !layout || !toggleSidebarButton || !hasLocalStorage) return;

  try {
    const saved = localStorage.getItem('sidebar-minimized');
    if (saved === 'true') {
      sidebar.classList.add('minimized');
      layout.classList.add('sidebar-minimized');
      toggleSidebarButton.title = 'Expandir barra lateral';
    }
  } catch (error) {
    console.warn('No se pudo restaurar el estado del sidebar', error);
  }
}

function toggleIncognitoMode() {
  incognitoMode = !incognitoMode;

  // Actualizar estado visual de ambos botones
  const buttons = [incognitoButton, incognitoButtonEmpty].filter(Boolean);
  buttons.forEach(button => {
    if (incognitoMode) {
      button.classList.add('active');
      button.title = 'Desactivar modo incógnito';
    } else {
      button.classList.remove('active');
      button.title = 'Activar modo incógnito';
    }
  });

  // Ocultar/mostrar la barra lateral
  if (sidebar && layout) {
    if (incognitoMode) {
      // ENTRANDO en modo incógnito
      sidebar.classList.add('hidden');
      layout.classList.add('sidebar-hidden');

      // Guardar el estado actual antes de entrar en modo incógnito
      stateBeforeIncognito = {
        conversations: JSON.parse(JSON.stringify(state.conversations)),
        order: [...state.order],
        activeId: state.activeId,
        currentModel: state.currentModel,
        attachedFiles: JSON.parse(JSON.stringify(attachedFiles))
      };

      // Limpiar el estado actual y crear una conversación temporal
      state.conversations = {};
      state.order = [];
      state.activeId = null;

      // Limpiar archivos adjuntos
      Object.keys(attachedFiles).forEach(key => delete attachedFiles[key]);

      // Crear una nueva conversación temporal para el modo incógnito
      createConversation();
      renderConversationList();
      renderActiveConversation();

    } else {
      // SALIENDO del modo incógnito
      sidebar.classList.remove('hidden');
      layout.classList.remove('sidebar-hidden');

      // Restaurar el estado anterior (sin guardar las conversaciones incógnito)
      if (stateBeforeIncognito) {
        state.conversations = stateBeforeIncognito.conversations;
        state.order = stateBeforeIncognito.order;
        state.activeId = stateBeforeIncognito.activeId;
        state.currentModel = stateBeforeIncognito.currentModel;

        // Restaurar archivos adjuntos
        Object.keys(attachedFiles).forEach(key => delete attachedFiles[key]);
        Object.assign(attachedFiles, stateBeforeIncognito.attachedFiles);

        stateBeforeIncognito = null;

        // Renderizar el estado restaurado
        renderConversationList();
        if (state.activeId && state.conversations[state.activeId]) {
          renderActiveConversation();
        } else if (state.order.length > 0) {
          setActiveConversation(state.order[0]);
        } else {
          createConversation();
        }

        // Sincronizar los selectores de modelo
        syncModelSelects();
      }

      // Restaurar el estado del sidebar si estaba minimizado
      loadSidebarState();
    }
  }
}

function init() {
  if (!chatList) return;

  loadState();
  loadSidebarState();
  loadCanvasState();

  // Cargar preferencia de fuente disléxica al iniciar
  const dyslexicFontEnabled = getDyslexicFontEnabled();
  applyDyslexicFont(dyslexicFontEnabled);

  if (!state.activeId || !state.conversations[state.activeId]) {
    createConversation();
  } else {
    renderConversationList();
    renderActiveConversation();
  }

  loadModels();

  [modelSelect, modelSelectInline].filter(Boolean).forEach(select => {
    select?.addEventListener('change', (event) => {
      state.currentModel = event.target.value;
      syncModelSelects();
      persistState();
    });
  });

  chatForm?.addEventListener('submit', handleSubmit);
  chatFormInline?.addEventListener('submit', handleSubmit);

  [promptInput, promptInputInline].filter(Boolean).forEach(input => {
    input?.addEventListener('input', () => autoResizeTextarea(input));
    autoResizeTextarea(input);
  });

  // Agregar manejador de Enter en ambos inputs
  if (promptInput && chatForm) {
    promptInput.addEventListener('keydown', (e) => handleKeyDown(e, chatForm));
  }
  if (promptInputInline && chatFormInline) {
    promptInputInline.addEventListener('keydown', (e) => handleKeyDown(e, chatFormInline));
  }

  quickActionButtons.forEach((button) =>
    button.addEventListener('click', handleQuickActionClick),
  );

  newConversationButton?.addEventListener('click', createConversation);
  renameConversationButton?.addEventListener('click', handleRenameActive);
  deleteConversationButton?.addEventListener('click', handleDeleteActive);

  toggleSidebarButton?.addEventListener('click', toggleSidebar);
  incognitoButton?.addEventListener('click', toggleIncognitoMode);
  incognitoButtonEmpty?.addEventListener('click', toggleIncognitoMode);

  // Atajos de teclado
  document.addEventListener('keydown', (e) => {
    // Control+B para abrir/cerrar la barra lateral
    if (e.ctrlKey && e.key === 'b') {
      e.preventDefault();
      toggleSidebar();
    }
    // Control+M para nueva conversación
    if (e.ctrlKey && e.key === 'm') {
      e.preventDefault();
      createConversation();
    }
    // Control+Shift+; para activar/desactivar modo incógnito
    if (e.ctrlKey && e.shiftKey && e.key === ';') {
      e.preventDefault();
      toggleIncognitoMode();
    }
  });

  // Configurar manejo de archivos
  setupFileHandlers();

  // Configurar badge de archivos
  const attachmentsBadge = document.getElementById('attachments-badge');
  const closeAttachments = document.getElementById('close-attachments');

  attachmentsBadge?.addEventListener('click', (e) => {
    e.stopPropagation();
    showAttachmentsDropdown();
  });

  closeAttachments?.addEventListener('click', () => {
    hideAttachmentsDropdown();
  });

  // Cerrar dropdown al hacer clic fuera
  document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('attachments-dropdown');
    const badge = document.getElementById('attachments-badge');
    if (dropdown && badge && !dropdown.contains(e.target) && !badge.contains(e.target)) {
      hideAttachmentsDropdown();
    }
  });

  // Event listeners para modales de conversación
  setupConversationModals();

  // Eventos para canvas
  setupCanvasEvents();
  renderCanvasPanel(state.activeId);
}

// Configurar modales de renombrar, eliminar y eliminar todos
function setupConversationModals() {
  // Modal de renombrar conversación
  const renameModal = document.getElementById('rename-conversation-modal');
  const closeRenameBtn = document.getElementById('close-rename-modal');
  const cancelRenameBtn = document.getElementById('cancel-rename-conversation');
  const confirmRenameBtn = document.getElementById('confirm-rename-conversation');
  const renameInput = document.getElementById('rename-conversation-input');

  closeRenameBtn?.addEventListener('click', closeRenameModal);
  cancelRenameBtn?.addEventListener('click', closeRenameModal);
  confirmRenameBtn?.addEventListener('click', confirmRenameConversation);

  renameInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      confirmRenameConversation();
    }
    if (e.key === 'Escape') {
      closeRenameModal();
    }
  });

  renameModal?.addEventListener('click', (e) => {
    if (e.target === renameModal) closeRenameModal();
  });

  // Modal de eliminar conversación
  const deleteModal = document.getElementById('delete-conversation-modal');
  const closeDeleteBtn = document.getElementById('close-delete-conversation-modal');
  const cancelDeleteBtn = document.getElementById('cancel-delete-conversation');
  const confirmDeleteBtn = document.getElementById('confirm-delete-conversation');

  closeDeleteBtn?.addEventListener('click', closeDeleteConversationModal);
  cancelDeleteBtn?.addEventListener('click', closeDeleteConversationModal);
  confirmDeleteBtn?.addEventListener('click', confirmDeleteConversation);

  deleteModal?.addEventListener('click', (e) => {
    if (e.target === deleteModal) closeDeleteConversationModal();
  });

  // Modal de eliminar todas las conversaciones
  const deleteAllBtn = document.getElementById('delete-all-conversations-btn');
  const deleteAllModal = document.getElementById('delete-all-conversations-modal');
  const closeDeleteAllBtn = document.getElementById('close-delete-all-modal');
  const cancelDeleteAllBtn = document.getElementById('cancel-delete-all');
  const confirmDeleteAllBtn = document.getElementById('confirm-delete-all');

  deleteAllBtn?.addEventListener('click', handleDeleteAllConversations);
  closeDeleteAllBtn?.addEventListener('click', closeDeleteAllModal);
  cancelDeleteAllBtn?.addEventListener('click', closeDeleteAllModal);
  confirmDeleteAllBtn?.addEventListener('click', confirmDeleteAllConversations);

  deleteAllModal?.addEventListener('click', (e) => {
    if (e.target === deleteAllModal) closeDeleteAllModal();
  });

  // Modal de editar mensaje
  const editMessageModal = document.getElementById('edit-message-modal');
  const closeEditMessageBtn = document.getElementById('close-edit-message-modal');
  const cancelEditMessageBtn = document.getElementById('cancel-edit-message');
  const confirmEditMessageBtn = document.getElementById('confirm-edit-message');
  const editMessageTextarea = document.getElementById('edit-message-textarea');

  closeEditMessageBtn?.addEventListener('click', closeEditMessageModal);
  cancelEditMessageBtn?.addEventListener('click', closeEditMessageModal);
  confirmEditMessageBtn?.addEventListener('click', confirmEditMessage);

  editMessageTextarea?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      confirmEditMessage();
    }
    if (e.key === 'Escape') {
      closeEditMessageModal();
    }
  });

  editMessageModal?.addEventListener('click', (e) => {
    if (e.target === editMessageModal) closeEditMessageModal();
  });
}

function setupCanvasEvents() {
  if (canvasCloseBtn) {
    canvasCloseBtn.addEventListener('click', () => {
      toggleCanvasVisibility(false);
    });
  }

  // Botón para cambiar vista del canvas
  const canvasViewToggle = document.getElementById('canvas-view-toggle');
  if (canvasViewToggle) {
    canvasViewToggle.addEventListener('click', () => {
      const canvasContent = document.querySelector('.canvas-content');
      if (!canvasContent) return;

      const currentMode = canvasContent.getAttribute('data-view-mode') || 'split';
      let nextMode = 'split';

      if (currentMode === 'split') {
        nextMode = 'editor';
      } else if (currentMode === 'editor') {
        nextMode = 'preview';
      } else {
        nextMode = 'split';
      }

      canvasContent.setAttribute('data-view-mode', nextMode);
      console.log('🔄 Vista Canvas cambiada a:', nextMode);
    });
  }

  // Delegar eventos de clic para las tarjetas de artifact
  document.addEventListener('click', (e) => {
    const artifactCard = e.target.closest('.artifact-card');
    if (artifactCard) {
      // Verificar si es una tarjeta de partitura
      if (artifactCard.classList.contains('score-artifact-card')) {
        const scoreId = artifactCard.dataset.scoreId;
        const versionNumber = parseInt(artifactCard.dataset.scoreVersion) || null;

        if (scoreId) {
          // Buscar el documento de partitura en todas las conversaciones
          Object.keys(state.conversations).forEach(convId => {
            const doc = getScoreDoc(convId);
            if (doc && doc.id === scoreId) {
              // Cambiar a la conversación si no es la activa
              if (state.activeId !== convId) {
                setActiveConversation(convId);
              }
              // Activar modo música si no está activo
              if (!musicMode && !window._musicModeActive) {
                setChatMode('music');
              }
              // Mostrar la partitura con la versión específica
              renderScoreCanvasPanel(convId, versionNumber);
              scrollChatToBottom();
            }
          });
        }
      } else {
        // Es una tarjeta de canvas normal
        const canvasId = artifactCard.dataset.canvasId;
        const versionNumber = parseInt(artifactCard.dataset.canvasVersion) || null;

        if (canvasId) {
          // Buscar el documento canvas en todas las conversaciones
          Object.keys(state.conversations).forEach(convId => {
            const doc = getCanvasDoc(convId);
            if (doc && doc.id === canvasId) {
              // Cambiar a la conversación si no es la activa
              if (state.activeId !== convId) {
                setActiveConversation(convId);
              }
              // Mostrar el canvas con la versión específica
              renderCanvasPanel(convId, versionNumber);
              scrollChatToBottom();
            }
          });
        }
      }
    }
  });
}

// Función para manejar pegado de imágenes desde el portapapeles (Ctrl+V)
function setupClipboardPaste() {
  // Escuchar eventos de pegado en todo el documento
  document.addEventListener('paste', async (e) => {
    // Verificar si hay items en el portapapeles
    const clipboardItems = e.clipboardData?.items;
    if (!clipboardItems) return;

    // Buscar imágenes en el portapapeles
    const imageItems = [];
    for (let i = 0; i < clipboardItems.length; i++) {
      const item = clipboardItems[i];
      if (item.type.startsWith('image/')) {
        imageItems.push(item);
      }
    }

    // Si no hay imágenes, permitir el comportamiento normal (pegar texto)
    if (imageItems.length === 0) return;

    // Prevenir el comportamiento por defecto solo si hay imágenes
    e.preventDefault();

    // Verificar que hay una conversación activa
    if (!state.activeId) {
      // Si no hay conversación activa, crear una
      createConversation();
    }

    // Procesar cada imagen del portapapeles
    const files = [];
    for (const item of imageItems) {
      const file = item.getAsFile();
      if (file) {
        // Generar un nombre único para la imagen pegada
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const extension = file.type.split('/')[1] || 'png';
        const fileName = `imagen-pegada-${timestamp}.${extension}`;

        // Crear un nuevo File con nombre personalizado
        const renamedFile = new File([file], fileName, { type: file.type });
        files.push(renamedFile);
      }
    }

    // Si hay archivos, procesarlos
    if (files.length > 0) {
      const isEmptyState = emptyState?.style.display !== 'none';
      await handleFiles(files, !isEmptyState);

      // Enfocar el input correspondiente después de pegar
      const activeInput = isEmptyState ? promptInput : promptInputInline;
      activeInput?.focus();

      // Mostrar notificación visual
      showPasteNotification(files.length);
    }
  });
}

// Función para mostrar notificación cuando se pega una imagen
function showPasteNotification(count) {
  // Crear elemento de notificación si no existe
  let notification = document.getElementById('paste-notification');
  if (!notification) {
    notification = document.createElement('div');
    notification.id = 'paste-notification';
    notification.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: rgba(42, 42, 42, 0.95);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      padding: 12px 16px;
      color: rgba(255, 255, 255, 0.9);
      font-size: 13px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      z-index: 10000;
      display: flex;
      align-items: center;
      gap: 8px;
      opacity: 0;
      transform: translateY(20px);
      transition: all 0.3s ease;
      max-width: 300px;
    `;
    document.body.appendChild(notification);
  }

  const message = count === 1
    ? 'Imagen pegada desde el portapapeles'
    : `${count} imágenes pegadas desde el portapapeles`;

  notification.innerHTML = `<span>📋</span><span>${message}</span>`;
  notification.style.opacity = '1';
  notification.style.transform = 'translateY(0)';

  // Ocultar después de 2.5 segundos
  setTimeout(() => {
    notification.style.opacity = '0';
    notification.style.transform = 'translateY(20px)';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  }, 2500);
}

function setupFileHandlers() {
  const fileInput = document.getElementById('file-input');
  const fileInputInline = document.getElementById('file-input-inline');
  const attachFileBtn = document.getElementById('attach-file-btn');
  const attachFileBtnInline = document.getElementById('attach-file-btn-inline');
  const fileDropArea = document.getElementById('file-drop-area');
  const fileDropAreaInline = document.getElementById('file-drop-area-inline');

  // Botones para abrir selector de archivos
  attachFileBtn?.addEventListener('click', () => fileInput?.click());
  attachFileBtnInline?.addEventListener('click', () => fileInputInline?.click());

  // Manejar pegado de imágenes desde el portapapeles (Ctrl+V)
  setupClipboardPaste();

  // Manejar selección de archivos
  fileInput?.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFiles(e.target.files, false);
      e.target.value = ''; // Resetear input
    }
  });

  fileInputInline?.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFiles(e.target.files, true);
      e.target.value = ''; // Resetear input
    }
  });

  // Drag and drop en empty-state (página principal)
  if (emptyState) {
    emptyState.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      emptyState.classList.add('drag-over');
    });

    emptyState.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Solo remover si realmente salimos del elemento
      if (!emptyState.contains(e.relatedTarget)) {
        emptyState.classList.remove('drag-over');
      }
    });

    emptyState.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      emptyState.classList.remove('drag-over');

      if (e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files, false);
      }
    });
  }

  // Drag and drop en chat-state
  if (chatState) {
    chatState.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      chatState.classList.add('drag-over');
    });

    chatState.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!chatState.contains(e.relatedTarget)) {
        chatState.classList.remove('drag-over');
      }
    });

    chatState.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      chatState.classList.remove('drag-over');

      if (e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files, true);
      }
    });
  }

  // Drag and drop en áreas de archivos (solo cuando hay archivos)
  [fileDropArea, fileDropAreaInline].forEach(area => {
    if (!area) return;

    area.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    area.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.dataTransfer.files.length > 0) {
        const isInline = area === fileDropAreaInline;
        handleFiles(e.dataTransfer.files, isInline);
      }
    });
  });
}

// Sistema de fondo con imágenes diarias
// Las fotos se cargan desde la carpeta photo/
const BACKGROUND_AUTO_KEY = 'ollama-web-background-auto';
const BACKGROUND_MANUAL_KEY = 'ollama-web-background-manual';

const PHOTOS = [
  'photo/Amapolas en Giverny-4PlDWaz5pyPbfHSUZORo-hd-png.png',
  'photo/Paseo por el acantilado en Pourville-3n9hPIFczHFbyrrqLki8-hd-jpg.jpg',
  'photo/La Playa en Trouville-JDjJ5hjHafRnEOORxYFH-hd-jpg.jpg',
  'photo/Puente de Waterloo, Londres, al anochecer-2ZkCL0uZxiZy0h7jcnpQ-hd-jpg.jpg',
  'photo/La Bahía de Antibes-estQxBHAwAOEt4QSFxZd-hd-png.png',
  'photo/1884 Calle Romana en Bordighera-XI6oT8T2YW9Uf3S31k7G-hd-jpg.jpg',
  'photo/Iris en el jardín de Monet-DU9ojbpxI0TpoyKV7M8c-hd-jpg.jpg',
  'photo/Marino-EJe2s7X77M2ImT8rEVJx-hd-png.png',
  'photo/Álamos en el Epte-6mRZ3ln8QjrokwBNAkwz-4k.jpg',
  'photo/Casa de pescador en Petit Ailly-81LyN1qySPHOjUlgb1BE-4k.jpg',
  'photo/El Puente Japonés (El Estanque de Nenúfares)-4fu0WvfYzycOaMPCIv8h-4k.jpg',
  'photo/Juan les Pins-Bm2sDPUlIC9RaBO64j4R-4k.jpg',
  'photo/wallpaper1.jpg',
  'photo/wallpaper2.jpg',
  'photo/Argenteuil. Yates-4kJbsbyBKFUobnFEKK3u-hd-png.png',
  'photo/Puente de Waterloo, Londres, al anochecer-2ZkCL0uZxiZy0h7jcnpQ-hd-png.png',
  'photo/Canoe on the Epte-2HF5cCC7u0ju6eRcwdwr-hd-jpg.jpg',
  'photo/Las Islas de Port-Villez-1LNtwj4xtUd5RqE54JPX-hd-png (1).png',
  'photo/the_seine_1971.57.1.jpg',
  'photo/1968.88 - A City Park.jpg',
  'photo/1985.1103 - Stacks of Wheat (End of Summer).jpg',
  'photo/1926.224 - A Sunday on La Grande Jatte — 1884.jpg',
  'photo/Las Islas de Port-Villez-1LNtwj4xtUd5RqE54JPX-hd-png.png',
  'photo/El Sena en Port-Villez (Un Raffo de Viento)-0T6oJ5ptMReH7rOgm94n-hd-png.png',
  'photo/El Sena cerca de Giverny-0HkCfvAxmenpol6H9BIu-hd-png.png',
  'photo/El mar y los Alpes-07VL03N3u7FhWqbrjGZT-hd-png.png',
  'photo/Zaan en Zaandam-7BpXtwQnAM6KtE5m5FZZ-hd-png.png',
  'photo/A la orilla del fiordo de Christiania-69bKwEcyCS89HJYIHenO-hd-png.png',
  'photo/Vista de Vetheuil sur Seine-1HAOmjsg9gjGzMgoXJTK-hd-png.png',
];

function getTodayDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getBackgroundAutoMode() {
  const autoMode = localStorage.getItem(BACKGROUND_AUTO_KEY);
  return autoMode === null ? true : autoMode === 'true'; // Por defecto está activado
}

function getManualBackground() {
  return localStorage.getItem(BACKGROUND_MANUAL_KEY);
}

function setBackgroundAutoMode(enabled) {
  localStorage.setItem(BACKGROUND_AUTO_KEY, String(enabled));
}

function setManualBackground(imagePath) {
  localStorage.setItem(BACKGROUND_MANUAL_KEY, imagePath);
}

function shouldChangeBackground() {
  // Si el modo automático está desactivado, no cambiar
  if (!getBackgroundAutoMode()) {
    return false;
  }

  const storedDate = localStorage.getItem(BACKGROUND_STORAGE_KEY);
  const today = getTodayDateString();

  // Cambiar solo cuando cambia el día (a las 00:00)
  if (!storedDate || storedDate !== today) {
    return true;
  }

  return false;
}

function selectDailyImage() {
  const today = getTodayDateString();

  // Usar la fecha como semilla para seleccionar una imagen consistente durante el día
  // La imagen cambia a las 00:00 cuando cambia el día
  const dateSeed = parseInt(today.replace(/-/g, '')) % PHOTOS.length;
  const selectedIndex = dateSeed;

  // Guardar la fecha del cambio
  localStorage.setItem(BACKGROUND_STORAGE_KEY, today);

  return PHOTOS[selectedIndex];
}

function setBackgroundImage() {
  const backgroundElement = document.getElementById('background-image');
  if (!backgroundElement) return;

  // Si el modo automático está desactivado, usar la imagen manual
  if (!getBackgroundAutoMode()) {
    const manualImage = getManualBackground();
    if (manualImage) {
      backgroundElement.style.backgroundImage = `url('${manualImage}')`;
      localStorage.setItem('ollama-web-background-image', manualImage);
      return;
    }
    // Si no hay imagen manual pero el modo está desactivado, usar la primera imagen
    const defaultImage = PHOTOS[0];
    backgroundElement.style.backgroundImage = `url('${defaultImage}')`;
    localStorage.setItem('ollama-web-background-image', defaultImage);
    return;
  }

  if (shouldChangeBackground()) {
    const imagePath = selectDailyImage();
    backgroundElement.style.backgroundImage = `url('${imagePath}')`;
    localStorage.setItem('ollama-web-background-image', imagePath);
  } else {
    // Usar la imagen guardada
    const storedImage = localStorage.getItem('ollama-web-background-image');
    if (storedImage) {
      backgroundElement.style.backgroundImage = `url('${storedImage}')`;
    } else {
      const imagePath = selectDailyImage();
      backgroundElement.style.backgroundImage = `url('${imagePath}')`;
      localStorage.setItem('ollama-web-background-image', imagePath);
    }
  }
}

function getGreetingMessage() {
  const now = new Date();
  const hour = now.getHours();

  let greeting, subtitle;

  if (hour >= 6 && hour < 12) {
    // Mañana: 6:00 - 11:59
    greeting = 'Buenos días';
    subtitle = '¿En qué puedo ayudarte esta mañana?';
  } else if (hour >= 12 && hour < 20) {
    // Tarde: 12:00 - 19:59
    greeting = 'Buenas tardes';
    subtitle = '¿Cómo puedo ayudarte esta tarde?';
  } else {
    // Noche: 20:00 - 5:59
    greeting = 'Buenas noches';
    subtitle = '¿Cómo puedo ayudarte esta noche?';
  }

  return { greeting, subtitle };
}

// Funciones para manejar el nombre del usuario
const USER_NAME_STORAGE_KEY = 'ollama-web-user-name';

function getUserName() {
  if (!hasLocalStorage) return 'Default';
  try {
    const storedName = window.localStorage.getItem(USER_NAME_STORAGE_KEY);
    return storedName || 'Default';
  } catch (error) {
    console.warn('No se pudo obtener el nombre del usuario', error);
    return 'Default';
  }
}

function saveUserName(name) {
  if (!hasLocalStorage) return;
  try {
    window.localStorage.setItem(USER_NAME_STORAGE_KEY, name);
  } catch (error) {
    console.warn('No se pudo guardar el nombre del usuario', error);
  }
}

// Funciones para manejar la personalización de IA
const AI_PERSONALIZATION_STORAGE_KEY = 'ollama-web-ai-personalization';

function getAIPersonalization() {
  if (!hasLocalStorage) return '';
  try {
    return window.localStorage.getItem(AI_PERSONALIZATION_STORAGE_KEY) || '';
  } catch (error) {
    console.warn('No se pudo obtener la personalización de IA', error);
    return '';
  }
}

function saveAIPersonalization(info) {
  if (!hasLocalStorage) return;
  try {
    window.localStorage.setItem(AI_PERSONALIZATION_STORAGE_KEY, info);
  } catch (error) {
    console.warn('No se pudo guardar la personalización de IA', error);
  }
}

// Funciones para manejar el estilo de respuesta
const AI_RESPONSE_STYLE_KEY = 'ollama-web-ai-response-style';

function getAIResponseStyle() {
  if (!hasLocalStorage) return 'normal';
  try {
    return window.localStorage.getItem(AI_RESPONSE_STYLE_KEY) || 'normal';
  } catch (error) {
    console.warn('No se pudo obtener el estilo de respuesta', error);
    return 'normal';
  }
}

function saveAIResponseStyle(style) {
  if (!hasLocalStorage) return;
  try {
    window.localStorage.setItem(AI_RESPONSE_STYLE_KEY, style);
  } catch (error) {
    console.warn('No se pudo guardar el estilo de respuesta', error);
  }
}

function getStyleInstructions(style) {
  const styleInstructions = {
    normal: '',
    aprendizaje: 'Proporciona respuestas pacientes y educativas que fomenten la comprensión. Explica los conceptos de manera clara y gradual, asegurándote de que el usuario entienda cada paso.',
    conciso: 'Proporciona respuestas más cortas y directas. Divide información larga en múltiples mensajes más breves cuando sea necesario.',
    explicativo: 'Proporciona respuestas didácticas para el aprendizaje. Explica el "por qué" detrás de las cosas y ayuda al usuario a entender los conceptos fundamentales.',
    formal: 'Proporciona respuestas claras y bien estructuradas. Usa un tono profesional y organiza la información de manera lógica y coherente.',
    plan: 'Deliver meticulously structured, strategic planning with comprehensive goal-oriented thinking. Provide detailed, step-by-step plans with clear objectives and actionable items.'
  };
  return styleInstructions[style] || '';
}

// ========================================
// Sistema de Modos de Chat Visibles
// ========================================
const VISIBLE_CHAT_MODES_KEY = 'ollama-web-visible-chat-modes';
const DEFAULT_VISIBLE_MODES = ['normal', 'canvas', 'web', 'deep', 'study', 'travel', 'health'];

function getVisibleChatModes() {
  if (!hasLocalStorage) return DEFAULT_VISIBLE_MODES;
  try {
    const stored = window.localStorage.getItem(VISIBLE_CHAT_MODES_KEY);
    if (stored) {
      const modes = JSON.parse(stored);
      // Asegurar que al menos un modo esté visible
      return modes.length > 0 ? modes : DEFAULT_VISIBLE_MODES;
    }
    return DEFAULT_VISIBLE_MODES;
  } catch (error) {
    console.warn('No se pudo obtener los modos de chat visibles', error);
    return DEFAULT_VISIBLE_MODES;
  }
}

function saveVisibleChatModes(modes) {
  if (!hasLocalStorage) return;
  try {
    // Asegurar que al menos un modo esté visible
    const modesToSave = modes.length > 0 ? modes : DEFAULT_VISIBLE_MODES;
    window.localStorage.setItem(VISIBLE_CHAT_MODES_KEY, JSON.stringify(modesToSave));
    // Actualizar la UI después de guardar
    updateChatModeTogglesVisibility();
  } catch (error) {
    console.warn('No se pudo guardar los modos de chat visibles', error);
  }
}

function updateChatModeTogglesVisibility() {
  const visibleModes = getVisibleChatModes();
  const toggles = document.querySelectorAll('.chat-mode-toggle');

  toggles.forEach(toggle => {
    const options = toggle.querySelectorAll('.chat-mode-option');
    let visibleCount = 0;
    let firstVisibleMode = null;
    const visibleModesList = [];
    const currentMode = toggle.getAttribute('data-active-mode') || state.chatMode || 'normal';

    options.forEach(option => {
      const mode = option.dataset.mode;
      // Si es el modo activo actual, SIEMPRE mostrarlo aunque no esté en la lista de visibles
      const isVisible = visibleModes.includes(mode) || mode === currentMode;
      option.style.display = isVisible ? '' : 'none';
      if (isVisible) {
        visibleCount++;
        visibleModesList.push(mode);
        if (!firstVisibleMode) firstVisibleMode = mode;
      }
    });

    // Si solo hay un modo visible, ocultar todo el toggle
    toggle.style.display = visibleCount > 1 ? '' : 'none';

    // Actualizar la posición del slider basada en modos visibles
    updateSliderPosition(toggle, visibleModesList);
  });
}

function updateSliderPosition(toggle, visibleModesList) {
  const slider = toggle.querySelector('.chat-mode-slider');
  if (!slider) return;

  const currentMode = toggle.getAttribute('data-active-mode');
  const index = visibleModesList.indexOf(currentMode);

  if (index !== -1) {
    // Calcular la posición: 3px inicial + (34px * índice)
    const translateX = 34 * index;
    slider.style.transform = `translateX(${translateX}px)`;
  }
}

// ========================================
// Sistema de Memoria
// ========================================
const MEMORY_STORAGE_KEY = 'ollama-web-memories';
const MEMORY_ENABLED_KEY = 'ollama-web-memory-enabled';

function getMemoryEnabled() {
  if (!hasLocalStorage) return true;
  try {
    const stored = window.localStorage.getItem(MEMORY_ENABLED_KEY);
    return stored === null ? true : stored === 'true';
  } catch (error) {
    console.warn('No se pudo obtener la preferencia de memoria', error);
    return true;
  }
}

function setMemoryEnabled(enabled) {
  if (!hasLocalStorage) return;
  try {
    window.localStorage.setItem(MEMORY_ENABLED_KEY, enabled ? 'true' : 'false');
  } catch (error) {
    console.warn('No se pudo guardar la preferencia de memoria', error);
  }
}

function getMemories() {
  if (!hasLocalStorage) return [];
  try {
    const stored = window.localStorage.getItem(MEMORY_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.warn('No se pudieron cargar las memorias', error);
    return [];
  }
}

function saveMemories(memories) {
  if (!hasLocalStorage) return;
  try {
    window.localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(memories));
  } catch (error) {
    console.warn('No se pudieron guardar las memorias', error);
  }
}

function addMemory(content) {
  if (!content || !content.trim()) return null;

  const memories = getMemories();
  const newMemory = {
    id: generateId('mem'),
    content: content.trim(),
    createdAt: Date.now()
  };
  memories.unshift(newMemory);
  saveMemories(memories);
  return newMemory;
}

function deleteMemory(memoryId) {
  const memories = getMemories();
  const filtered = memories.filter(m => m.id !== memoryId);
  saveMemories(filtered);
  return filtered;
}

function clearAllMemories() {
  saveMemories([]);
}

function formatMemoryDate(timestamp) {
  const date = new Date(timestamp);
  const options = { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' };
  return date.toLocaleDateString('es-ES', options);
}

// Función para construir el contexto de memorias para el modelo
function buildMemoryContext() {
  if (!getMemoryEnabled()) return '';

  const memories = getMemories();
  if (memories.length === 0) return '';

  // Construir un contexto más estructurado y claro
  let context = 'INFORMACIÓN IMPORTANTE SOBRE EL USUARIO (usa estos datos para personalizar tus respuestas):\n';
  memories.forEach((memory, index) => {
    context += `• ${memory.content}\n`;
  });
  context += '\nIMPORTANTE: Ten en cuenta esta información al responder. Úsala naturalmente cuando sea relevante, pero no la menciones explícitamente ni digas que tienes esta información guardada.';

  return context;
}

// Función para contar palabras en un texto
function countWords(text) {
  return text.trim().split(/\s+/).filter(word => word.length > 0).length;
}

// Función para mostrar notificación cuando se añade una memoria automáticamente
function showMemoryNotification(message) {
  // Crear elemento de notificación si no existe
  let notification = document.getElementById('memory-notification');
  if (!notification) {
    notification = document.createElement('div');
    notification.id = 'memory-notification';
    notification.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: rgba(42, 42, 42, 0.95);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      padding: 12px 16px;
      color: rgba(255, 255, 255, 0.9);
      font-size: 13px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      z-index: 10000;
      display: flex;
      align-items: center;
      gap: 8px;
      opacity: 0;
      transform: translateY(20px);
      transition: all 0.3s ease;
      max-width: 300px;
    `;
    document.body.appendChild(notification);
  }

  notification.innerHTML = `<span>🧠</span><span>${escapeHtml(message)}</span>`;
  notification.style.opacity = '1';
  notification.style.transform = 'translateY(0)';

  // Ocultar después de 3 segundos
  setTimeout(() => {
    notification.style.opacity = '0';
    notification.style.transform = 'translateY(20px)';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  }, 3000);
}

// Función para verificar si una memoria ya existe (evitar duplicados)
function memoryExists(content) {
  const memories = getMemories();
  const normalizedContent = content.trim().toLowerCase();
  return memories.some(m => m.content.trim().toLowerCase() === normalizedContent);
}

// Función para extraer información importante de una conversación usando la IA
async function extractImportantInfoFromConversation(userMessage, assistantResponse) {
  if (!getMemoryEnabled() || !state.currentModel) return;

  // Solo procesar si hay contenido suficiente
  if (!userMessage || !assistantResponse || assistantResponse.length < 20) return;

  try {
    // Crear un prompt más preciso para extraer información personal del usuario
    const extractionPrompt = `Eres un extractor de información personal. Analiza lo que el USUARIO dijo y extrae SOLO datos personales sobre él/ella.

REGLAS ESTRICTAS:
1. Solo extraer información personal del usuario (nombre, trabajo, estudios, gustos, familia, ubicación)
2. NO extraer información general, definiciones o explicaciones
3. Cada dato debe ser UNA FRASE CORTA en tercera persona (ej: "Se llama Juan", "Estudia derecho", "Vive en Madrid")
4. Máximo 8 palabras por frase
5. Si el usuario pregunta algo pero NO revela información personal, responde: NINGUNA
6. Separar múltiples datos con |

EJEMPLOS:
- Usuario: "Me llamo Juan y estudio derecho" → "Se llama Juan|Estudia derecho"
- Usuario: "¿Qué es Python?" → "NINGUNA" (solo pregunta, no hay info personal)
- Usuario: "Trabajo en Google como programador" → "Trabaja en Google|Es programador"
- Usuario: "Me gusta mucho el café" → "Le gusta el café"
- Usuario: "Tengo 2 hijos y un perro" → "Tiene 2 hijos|Tiene un perro"

MENSAJE DEL USUARIO: "${userMessage.substring(0, 300)}"

Extrae información personal del usuario (o responde NINGUNA si no hay):`;

    const response = await fetch(`${API_BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: state.currentModel,
        prompt: extractionPrompt,
        stream: false,
        options: {
          temperature: 0.1, // Muy baja temperatura para respuestas más precisas
          num_predict: 150 // Respuesta corta
        }
      })
    });

    if (!response.ok) return;

    const data = await response.json();
    const extractedText = data.response?.trim() || '';

    // Si no hay información, salir
    if (!extractedText ||
      extractedText.toUpperCase() === 'NINGUNA' ||
      extractedText.toLowerCase().includes('ninguna') ||
      extractedText.toLowerCase().includes('no hay información') ||
      extractedText.toLowerCase().includes('no se menciona')) {
      return;
    }

    // Procesar las frases extraídas (separadas por | o saltos de línea)
    const phrases = extractedText
      .split(/[|\n]/)
      .map(p => p.trim().replace(/^[-•*]\s*/, '')) // Limpiar bullets
      .filter(p => {
        const wordCount = countWords(p);
        const pLower = p.toLowerCase();

        // Filtrar frases válidas
        return p.length >= 5 &&
          p.length <= 80 &&
          wordCount >= 2 &&
          wordCount <= 10 &&
          !pLower.includes('ninguna') &&
          !pLower.includes('no hay') &&
          !pLower.includes('no se') &&
          !pLower.includes('el usuario') &&
          !pLower.includes('información personal') &&
          !memoryExists(p);
      });

    // Añadir cada frase como memoria (máximo 3 por mensaje)
    let addedCount = 0;
    for (const phrase of phrases) {
      if (addedCount >= 3) break;
      if (phrase && phrase.length >= 5) {
        addMemory(phrase);
        addedCount++;
      }
    }

    // Si se añadieron memorias, actualizar la lista en el modal si está abierto
    if (addedCount > 0 && typeof window.renderMemoriesList === 'function') {
      window.renderMemoriesList();
    }
  } catch (error) {
    console.warn('Error al extraer información importante:', error);
    // No mostrar error al usuario, solo registrar
  }
}

// Función mejorada para extraer información usando análisis de texto simple
function extractInfoSimple(userMessage, assistantResponse) {
  if (!getMemoryEnabled()) return [];

  const extracted = [];

  // Patrones para extraer información COMPLETA del mensaje del usuario
  // Capturamos la frase completa incluyendo el verbo introductorio
  const userPatterns = [
    // Nombres y presentaciones
    /(?:me llamo|mi nombre es|soy)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)*)/gi,
    // Estudios y trabajo - captura completa
    /(?:estudio|estudié|trabajo en|trabajo como|trabajé en|trabajé como)\s+([^.,!?\n]{3,50})/gi,
    // Ubicación
    /(?:vivo en|soy de|vengo de|nací en)\s+([^.,!?\n]{3,40})/gi,
    // Gustos y preferencias - captura completa
    /(?:me gusta|me gustan|me encanta|me encantan|adoro|amo)\s+([^.,!?\n]{3,50})/gi,
    /(?:no me gusta|no me gustan|odio|detesto)\s+([^.,!?\n]{3,50})/gi,
    /(?:prefiero|mi favorito es|mi favorita es|mis favoritos son)\s+([^.,!?\n]{3,50})/gi,
    // Edad y datos personales
    /tengo\s+(\d+\s+años)/gi,
    // Hobbies y actividades
    /(?:practico|juego|hago|suelo)\s+([^.,!?\n]{3,40})/gi,
    // Familia y relaciones
    /(?:mi (?:esposa|esposo|pareja|novio|novia|hermano|hermana|hijo|hija|padre|madre|familia))\s+([^.,!?\n]{3,40})/gi,
    /tengo\s+((?:\d+\s+)?(?:hijos?|hermanos?|mascotas?|perros?|gatos?))/gi,
    // Profesión directa
    /soy\s+(programador|ingeniero|médico|profesor|estudiante|diseñador|abogado|arquitecto|enfermero|contador|[a-záéíóúñ]+(?:or|ero|ista|ente|dor)(?:a)?)/gi,
  ];

  userPatterns.forEach(pattern => {
    let match;
    // Usar exec para obtener grupos de captura correctamente
    const regex = new RegExp(pattern.source, pattern.flags);
    while ((match = regex.exec(userMessage)) !== null) {
      if (match[1]) {
        // Reconstruir la frase completa con contexto
        const fullMatch = match[0].trim();
        const captured = match[1].trim();

        // Limpiar y validar
        const cleaned = captured.replace(/[.,!?;:]+$/, '').trim();
        const wordCount = countWords(cleaned);

        // Para nombres, usar solo el nombre capturado
        if (pattern.source.includes('me llamo|mi nombre es')) {
          if (cleaned.length >= 2 && !memoryExists(`Se llama ${cleaned}`)) {
            extracted.push(`Se llama ${cleaned}`);
          }
        }
        // Para otros, incluir el contexto
        else if (wordCount >= 1 && wordCount <= 12 && cleaned.length >= 3) {
          // Crear frase con contexto
          let contextPhrase = fullMatch.replace(/[.,!?;:]+$/, '').trim();

          // Convertir a tercera persona si es necesario
          contextPhrase = contextPhrase
            .replace(/^me llamo\s+/i, 'Se llama ')
            .replace(/^mi nombre es\s+/i, 'Se llama ')
            .replace(/^soy\s+/i, 'Es ')
            .replace(/^estudio\s+/i, 'Estudia ')
            .replace(/^estudié\s+/i, 'Estudió ')
            .replace(/^trabajo en\s+/i, 'Trabaja en ')
            .replace(/^trabajo como\s+/i, 'Trabaja como ')
            .replace(/^vivo en\s+/i, 'Vive en ')
            .replace(/^soy de\s+/i, 'Es de ')
            .replace(/^me gusta\s+/i, 'Le gusta ')
            .replace(/^me gustan\s+/i, 'Le gustan ')
            .replace(/^me encanta\s+/i, 'Le encanta ')
            .replace(/^no me gusta\s+/i, 'No le gusta ')
            .replace(/^prefiero\s+/i, 'Prefiere ')
            .replace(/^tengo\s+/i, 'Tiene ')
            .replace(/^practico\s+/i, 'Practica ')
            .replace(/^juego\s+/i, 'Juega ')
            .replace(/^hago\s+/i, 'Hace ');

          if (!memoryExists(contextPhrase) && contextPhrase.length >= 5) {
            extracted.push(contextPhrase);
          }
        }
      }
    }
  });

  // Eliminar duplicados y limitar cantidad
  const unique = [...new Set(extracted)];
  return unique.slice(0, 3); // Máximo 3 memorias por mensaje
}

// Funciones para manejar la fuente disléxica
function getDyslexicFontEnabled() {
  if (!hasLocalStorage) return false;
  try {
    const stored = window.localStorage.getItem(DYSLEXIC_FONT_KEY);
    return stored === 'true';
  } catch (error) {
    console.warn('No se pudo obtener la preferencia de fuente disléxica', error);
    return false;
  }
}

function saveDyslexicFontEnabled(enabled) {
  if (!hasLocalStorage) return;
  try {
    window.localStorage.setItem(DYSLEXIC_FONT_KEY, enabled ? 'true' : 'false');
  } catch (error) {
    console.warn('No se pudo guardar la preferencia de fuente disléxica', error);
  }
}

function applyDyslexicFont(enabled) {
  if (enabled) {
    document.body.classList.add('dyslexic-font-enabled');
  } else {
    document.body.classList.remove('dyslexic-font-enabled');
  }
}

function updateGreeting() {
  const greetingElement = document.getElementById('greeting-text');

  if (!greetingElement) return;

  const userName = getUserName();
  const firstName = userName.split(' ')[0];

  if (window.translationManager) {
    // Determine time of day for correct greeting key
    const now = new Date();
    const hour = now.getHours();
    let greetingKey = 'greeting.evening'; // Default

    if (hour >= 5 && hour < 12) {
      greetingKey = 'greeting.morning';
    } else if (hour >= 12 && hour < 20) {
      greetingKey = 'greeting.afternoon';
    }

    const translated = window.translationManager.translate(greetingKey, { name: firstName });
    // Wrap with logo image and proper structure
    greetingElement.innerHTML = `<span class="greeting-message">${translated}</span>`;
  } else {
    // Fallback
    const { greeting } = getGreetingMessage();
    greetingElement.innerHTML = `<span class="greeting-message">${greeting}, </span><span class="user-name">${firstName}</span>`;
  }
}

// Precargar todas las imágenes de fondo en caché al iniciar
function preloadBackgroundImages() {
  PHOTOS.forEach((photoPath) => {
    const img = new Image();
    img.src = photoPath;
    // No necesitamos hacer nada más, solo cargar en caché
  });
}

function initBackgroundSystem() {
  setBackgroundImage();
  updateGreeting();

  // Preload all background images in background
  // Use requestIdleCallback if available, otherwise setTimeout
  if (window.requestIdleCallback) {
    requestIdleCallback(() => {
      preloadBackgroundImages();
    }, { timeout: 2000 });
  } else {
    setTimeout(() => {
      preloadBackgroundImages();
    }, 1000);
  }

  // Check every minute if background needs to change (at 00:00)
  setInterval(() => {
    if (shouldChangeBackground()) {
      setBackgroundImage();
    }
    updateGreeting(); // Update greeting every minute in case hour changes
  }, 60000); // Cada minuto
}

function updateUserNameDisplay() {
  const userName = getUserName();
  const userNameDisplay = document.getElementById('user-name-display');
  if (userNameDisplay) {
    userNameDisplay.textContent = userName;
  }

  // Actualizar también en el saludo
  updateGreeting();


  // Actualizar avatar con primera letra
  const avatar = document.querySelector('.user-card .avatar');
  if (avatar && userName) {
    avatar.textContent = userName.charAt(0).toUpperCase();
  }
}

function initUserMenu() {
  const userCard = document.getElementById('user-card');
  const userMenu = document.getElementById('user-menu');
  const settingsMenu = document.getElementById('settings-menu');
  const settingsBtn = document.getElementById('settings-btn');
  const changeNameBtnMenu = document.getElementById('change-name-btn-menu');
  const aiPersonalizationBtn = document.getElementById('ai-personalization-btn');
  const changeNameModal = document.getElementById('change-name-modal');
  const closeNameModal = document.getElementById('close-name-modal');
  const cancelNameChange = document.getElementById('cancel-name-change');
  const saveNameChange = document.getElementById('save-name-change');
  const newNameInput = document.getElementById('new-name-input');
  const aiPersonalizationModal = document.getElementById('ai-personalization-modal');
  const closeAIPersonalizationModal = document.getElementById('close-ai-personalization-modal');
  const cancelAIPersonalization = document.getElementById('cancel-ai-personalization');
  const saveAIPersonalizationBtn = document.getElementById('save-ai-personalization');
  const aiPersonalInfoInput = document.getElementById('ai-personal-info-input');

  if (!userCard || !userMenu) return;

  // Toggle del menú al hacer clic en la tarjeta de usuario
  userCard.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = userMenu.style.display !== 'none';
    userMenu.style.display = isOpen ? 'none' : 'block';
    userCard.classList.toggle('active', !isOpen);
    // Cerrar submenú de configuración si está abierto
    if (settingsMenu) {
      settingsMenu.style.display = 'none';
    }
  });

  // Cerrar menú al hacer clic fuera
  document.addEventListener('click', (e) => {
    if (!userCard.contains(e.target) && !userMenu.contains(e.target) &&
      (!settingsMenu || !settingsMenu.contains(e.target))) {
      userMenu.style.display = 'none';
      userCard.classList.remove('active');
      if (settingsMenu) {
        settingsMenu.style.display = 'none';
      }
    }
  });

  // Configuración - Abrir submenú de configuración
  if (settingsBtn) {
    settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (settingsMenu) {
        const isOpen = settingsMenu.style.display !== 'none';
        settingsMenu.style.display = isOpen ? 'none' : 'block';

        // Marcar el tema actual como seleccionado
        if (!isOpen) {
          const currentTheme = getCurrentTheme();
          const themeOptions = settingsMenu.querySelectorAll('.theme-option-compact');
          themeOptions.forEach(option => {
            if (option.dataset.theme === currentTheme) {
              option.classList.add('active');
            } else {
              option.classList.remove('active');
            }
          });

          // Marcar la fuente actual como seleccionada
          const isDyslexicEnabled = getDyslexicFontEnabled();
          const fontOptions = settingsMenu.querySelectorAll('.font-option');
          fontOptions.forEach(option => {
            const isCurrentFont = (option.dataset.font === 'dyslexic' && isDyslexicEnabled) ||
              (option.dataset.font === 'normal' && !isDyslexicEnabled);
            if (isCurrentFont) {
              option.classList.add('active');
            } else {
              option.classList.remove('active');
            }
          });
        }
      }
    });
  }

  // Manejar selección de fuente en el submenú
  const fontOptions = settingsMenu?.querySelectorAll('.font-option');
  if (fontOptions) {
    fontOptions.forEach(option => {
      option.addEventListener('click', (e) => {
        e.stopPropagation();
        const fontType = option.dataset.font;
        const enableDyslexic = fontType === 'dyslexic';

        // Guardar y aplicar la preferencia
        saveDyslexicFontEnabled(enableDyslexic);
        applyDyslexicFont(enableDyslexic);

        // Actualizar estado visual
        fontOptions.forEach(opt => opt.classList.remove('active'));
        option.classList.add('active');
      });
    });
  }

  // Manejar selector de idioma en el menú de settings
  const languageBtnMenu = document.getElementById('language-btn-menu');
  const languageSubmenu = document.getElementById('language-submenu');
  if (languageBtnMenu && languageSubmenu) {
    languageBtnMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = languageSubmenu.style.display !== 'none';
      languageSubmenu.style.display = isOpen ? 'none' : 'block';
    });
  }

  // Abrir modal de cambio de nombre desde el submenú
  if (changeNameBtnMenu) {
    changeNameBtnMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      if (changeNameModal) {
        changeNameModal.style.display = 'flex';
        if (newNameInput) {
          newNameInput.value = getUserName();
          setTimeout(() => newNameInput.focus(), 100);
        }
        if (settingsMenu) {
          settingsMenu.style.display = 'none';
        }
        userMenu.style.display = 'none';
        userCard.classList.remove('active');
      }
    });
  }

  // Abrir modal de personalización de IA desde el submenú
  if (aiPersonalizationBtn) {
    aiPersonalizationBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (aiPersonalizationModal) {
        aiPersonalizationModal.style.display = 'flex';
        if (aiPersonalInfoInput) {
          aiPersonalInfoInput.value = getAIPersonalization();
        }

        // Cargar y marcar el estilo seleccionado
        const currentStyle = getAIResponseStyle();
        const styleOptions = aiPersonalizationModal.querySelectorAll('.style-option-compact');
        styleOptions.forEach(option => {
          if (option.dataset.style === currentStyle) {
            option.classList.add('active');
          } else {
            option.classList.remove('active');
          }
        });


        // Cargar modos de chat visibles
        const visibleModes = getVisibleChatModes();
        const modeCheckboxes = aiPersonalizationModal.querySelectorAll('#chat-modes-selector input[type="checkbox"]');
        modeCheckboxes.forEach(checkbox => {
          checkbox.checked = visibleModes.includes(checkbox.dataset.mode);
        });

        setTimeout(() => aiPersonalInfoInput.focus(), 100);
        if (settingsMenu) {
          settingsMenu.style.display = 'none';
        }
        userMenu.style.display = 'none';
        userCard.classList.remove('active');
      }
    });
  }

  // ========================================
  // Modal de Memoria
  // ========================================
  const memoryBtn = document.getElementById('memory-btn');
  const memoryModal = document.getElementById('memory-modal');
  const closeMemoryModal = document.getElementById('close-memory-modal');
  const closeMemoryModalBtn = document.getElementById('close-memory-modal-btn');
  const memoryEnabledToggle = document.getElementById('memory-enabled-toggle');
  const newMemoryInput = document.getElementById('new-memory-input');
  const addMemoryBtn = document.getElementById('add-memory-btn');
  const clearAllMemoriesBtn = document.getElementById('clear-all-memories-btn');
  const memoriesList = document.getElementById('memories-list');

  // Función para renderizar la lista de memorias (accesible globalmente)
  window.renderMemoriesList = function () {
    const memoriesListEl = document.getElementById('memories-list');
    if (!memoriesListEl) return;

    const memories = getMemories();

    if (memories.length === 0) {
      memoriesListEl.innerHTML = `
        <div class="memory-empty-state">
          <span class="memory-empty-icon">💭</span>
          <p>No hay recuerdos guardados</p>
          <p class="memory-empty-hint">Añade información que quieras que la IA recuerde sobre ti</p>
        </div>
      `;
      return;
    }

    memoriesListEl.innerHTML = memories.map(memory => `
      <div class="memory-item" data-memory-id="${memory.id}">
        <div class="memory-icon">💡</div>
        <div class="memory-content">
          <div class="memory-text">${escapeHtml(memory.content)}</div>
          <div class="memory-date">${formatMemoryDate(memory.createdAt)}</div>
        </div>
        <button class="memory-delete-btn" title="Eliminar recuerdo" data-memory-id="${memory.id}">×</button>
      </div>
    `).join('');

    // Añadir handlers de eliminación
    memoriesListEl.querySelectorAll('.memory-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const memoryId = btn.dataset.memoryId;
        deleteMemory(memoryId);
        window.renderMemoriesList();
      });
    });
  };

  const renderMemoriesList = window.renderMemoriesList;

  // Abrir modal de memoria
  if (memoryBtn) {
    memoryBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (memoryModal) {
        memoryModal.style.display = 'flex';

        // Cargar estado del toggle
        if (memoryEnabledToggle) {
          memoryEnabledToggle.checked = getMemoryEnabled();
        }

        // Renderizar lista de memorias
        if (typeof window.renderMemoriesList === 'function') {
          window.renderMemoriesList();
        }

        if (settingsMenu) {
          settingsMenu.style.display = 'none';
        }
        userMenu.style.display = 'none';
        userCard.classList.remove('active');
      }
    });
  }

  // Cerrar modal de memoria
  const closeMemoryModalFunc = () => {
    if (memoryModal) {
      memoryModal.style.display = 'none';
      if (newMemoryInput) {
        newMemoryInput.value = '';
      }
    }
  };

  if (closeMemoryModal) {
    closeMemoryModal.addEventListener('click', closeMemoryModalFunc);
  }

  if (closeMemoryModalBtn) {
    closeMemoryModalBtn.addEventListener('click', closeMemoryModalFunc);
  }

  // Cerrar modal al hacer clic fuera
  if (memoryModal) {
    memoryModal.addEventListener('click', (e) => {
      if (e.target === memoryModal) {
        closeMemoryModalFunc();
      }
    });
  }

  // Guardar estado del toggle de memoria
  if (memoryEnabledToggle) {
    memoryEnabledToggle.addEventListener('change', (e) => {
      setMemoryEnabled(e.target.checked);
    });
  }

  // Añadir nuevo recuerdo
  if (addMemoryBtn && newMemoryInput) {
    const addNewMemory = () => {
      const content = newMemoryInput.value.trim();
      if (content) {
        addMemory(content);
        newMemoryInput.value = '';
        if (typeof window.renderMemoriesList === 'function') {
          window.renderMemoriesList();
        }
      }
    };

    addMemoryBtn.addEventListener('click', addNewMemory);

    // Permitir añadir con Enter
    newMemoryInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        addNewMemory();
      }
      if (e.key === 'Escape') {
        closeMemoryModalFunc();
      }
    });
  }

  // Borrar todas las memorias
  if (clearAllMemoriesBtn) {
    clearAllMemoriesBtn.addEventListener('click', () => {
      if (confirm(window.translationManager ? window.translationManager.translate('confirm.clearMemories') : '¿Estás seguro de que quieres borrar todos los recuerdos?')) {
        clearAllMemories();
        if (typeof window.renderMemoriesList === 'function') {
          window.renderMemoriesList();
        }
      }
    });
  }

  // Manejar selección de estilos
  const styleOptions = aiPersonalizationModal?.querySelectorAll('.style-option-compact');
  if (styleOptions) {
    styleOptions.forEach(option => {
      option.addEventListener('click', () => {
        // Remover active de todos los botones
        styleOptions.forEach(opt => opt.classList.remove('active'));
        // Agregar active al botón seleccionado
        option.classList.add('active');
      });
    });
  }

  // Cerrar modal de cambio de nombre
  const closeNameModalFunc = () => {
    if (changeNameModal) {
      changeNameModal.style.display = 'none';
      if (newNameInput) {
        newNameInput.value = '';
      }
    }
  };

  if (closeNameModal) {
    closeNameModal.addEventListener('click', closeNameModalFunc);
  }

  if (cancelNameChange) {
    cancelNameChange.addEventListener('click', closeNameModalFunc);
  }

  // Cerrar modal de cambio de nombre al hacer clic fuera
  if (changeNameModal) {
    changeNameModal.addEventListener('click', (e) => {
      if (e.target === changeNameModal) {
        closeNameModalFunc();
      }
    });
  }

  // Cerrar modal de personalización de IA
  const closeAIPersonalizationModalFunc = () => {
    if (aiPersonalizationModal) {
      aiPersonalizationModal.style.display = 'none';
      if (aiPersonalInfoInput) {
        aiPersonalInfoInput.value = '';
      }
    }
  };

  if (closeAIPersonalizationModal) {
    closeAIPersonalizationModal.addEventListener('click', closeAIPersonalizationModalFunc);
  }

  if (cancelAIPersonalization) {
    cancelAIPersonalization.addEventListener('click', closeAIPersonalizationModalFunc);
  }

  // Cerrar modal de personalización de IA al hacer clic fuera
  if (aiPersonalizationModal) {
    aiPersonalizationModal.addEventListener('click', (e) => {
      if (e.target === aiPersonalizationModal) {
        closeAIPersonalizationModalFunc();
      }
    });
  }

  // Guardar nombre
  if (saveNameChange && newNameInput) {
    saveNameChange.addEventListener('click', () => {
      const newName = newNameInput.value.trim();
      if (newName) {
        saveUserName(newName);
        updateUserNameDisplay();
        closeNameModalFunc();
      }
    });

    // Permitir guardar con Enter
    newNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        saveNameChange.click();
      }
      if (e.key === 'Escape') {
        closeNameModalFunc();
      }
    });
  }

  // Guardar personalización de IA
  if (saveAIPersonalizationBtn && aiPersonalInfoInput) {
    saveAIPersonalizationBtn.addEventListener('click', () => {
      const personalInfo = aiPersonalInfoInput.value.trim();
      saveAIPersonalization(personalInfo);

      // Guardar el estilo seleccionado
      const selectedStyleOption = aiPersonalizationModal?.querySelector('.style-option-compact.active');
      if (selectedStyleOption) {
        const selectedStyle = selectedStyleOption.dataset.style || 'normal';
        saveAIResponseStyle(selectedStyle);
      }


      // Guardar modos de chat visibles
      const modeCheckboxes = aiPersonalizationModal?.querySelectorAll('#chat-modes-selector input[type="checkbox"]');
      if (modeCheckboxes) {
        const selectedModes = [];
        modeCheckboxes.forEach(checkbox => {
          if (checkbox.checked) {
            selectedModes.push(checkbox.dataset.mode);
          }
        });
        saveVisibleChatModes(selectedModes);
      }

      closeAIPersonalizationModalFunc();
    });

    // Permitir guardar con Ctrl+Enter o Cmd+Enter
    aiPersonalInfoInput.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        saveAIPersonalizationBtn.click();
      }
      if (e.key === 'Escape') {
        closeAIPersonalizationModalFunc();
      }
    });
  }

  // Cargar y mostrar el nombre guardado
  updateUserNameDisplay();

  // Inicializar sistema de temas
  initThemeSystem();

  // Personalización de fondo
  const backgroundPersonalizationBtn = document.getElementById('background-personalization-btn');
  const backgroundPersonalizationModal = document.getElementById('background-personalization-modal');
  const closeBackgroundPersonalizationModal = document.getElementById('close-background-personalization-modal');
  const cancelBackgroundPersonalization = document.getElementById('cancel-background-personalization');
  const saveBackgroundPersonalizationBtn = document.getElementById('save-background-personalization');
  const autoBackgroundToggle = document.getElementById('auto-background-toggle');
  const manualBackgroundSection = document.getElementById('manual-background-section');
  const backgroundGallery = document.getElementById('background-gallery');

  // Función para cargar la galería de imágenes (ya precargadas en caché)
  function loadBackgroundGallery() {
    if (!backgroundGallery) return;

    const manualImage = getManualBackground();
    const isAutoMode = getBackgroundAutoMode();

    // Limpiar galería
    backgroundGallery.innerHTML = '';

    // Cargar imágenes de forma asíncrona para no bloquear el UI
    // Usar requestAnimationFrame para permitir que el modal se renderice primero
    requestAnimationFrame(() => {
      // Dividir la carga en pequeños lotes para no bloquear
      let index = 0;

      const loadNextBatch = () => {
        const batchSize = 3; // Cargar 3 imágenes por frame
        const endIndex = Math.min(index + batchSize, PHOTOS.length);

        for (let i = index; i < endIndex; i++) {
          const photoPath = PHOTOS[i];
          const item = document.createElement('div');
          item.className = 'background-gallery-item';
          item.dataset.imagePath = photoPath;

          const img = document.createElement('img');
          img.src = photoPath;
          img.alt = `Fondo ${i + 1}`;
          img.loading = 'eager';

          item.appendChild(img);
          backgroundGallery.appendChild(item);

          // Marcar como activa si es la imagen manual seleccionada
          if (!isAutoMode && manualImage === photoPath) {
            item.classList.add('active');
          }

          // Seleccionar imagen al hacer clic
          item.addEventListener('click', () => {
            // Remover active de todos los items
            backgroundGallery.querySelectorAll('.background-gallery-item').forEach(i => {
              i.classList.remove('active');
            });
            // Agregar active al item seleccionado
            item.classList.add('active');
          });
        }

        index = endIndex;

        // Continuar cargando el siguiente lote si quedan imágenes
        if (index < PHOTOS.length) {
          requestAnimationFrame(loadNextBatch);
        }
      };

      // Iniciar la carga
      loadNextBatch();
    });
  }

  // Abrir modal de personalización de fondo
  if (backgroundPersonalizationBtn) {
    backgroundPersonalizationBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (backgroundPersonalizationModal) {
        // Cargar estado actual ANTES de mostrar el modal para evitar bloqueos
        const autoMode = getBackgroundAutoMode();
        if (autoBackgroundToggle) {
          autoBackgroundToggle.checked = autoMode;
        }
        if (manualBackgroundSection) {
          manualBackgroundSection.style.display = autoMode ? 'none' : 'block';
        }

        // Mostrar el modal inmediatamente
        backgroundPersonalizationModal.style.display = 'flex';
        if (settingsMenu) {
          settingsMenu.style.display = 'none';
        }
        userMenu.style.display = 'none';
        userCard.classList.remove('active');

        // Forzar un reflow para asegurar que el modal se renderice
        void backgroundPersonalizationModal.offsetHeight;

        // Cargar galería de forma completamente asíncrona después de mostrar el modal
        // Usar requestIdleCallback si está disponible para no bloquear
        if (window.requestIdleCallback) {
          requestIdleCallback(() => {
            loadBackgroundGallery();
          }, { timeout: 100 });
        } else {
          requestAnimationFrame(() => {
            setTimeout(() => {
              loadBackgroundGallery();
            }, 0);
          });
        }
      }
    });
  }

  // Manejar toggle del switch
  if (autoBackgroundToggle && manualBackgroundSection) {
    autoBackgroundToggle.addEventListener('change', (e) => {
      manualBackgroundSection.style.display = e.target.checked ? 'none' : 'block';
    });
  }

  // Cerrar modal de personalización de fondo
  const closeBackgroundPersonalizationModalFunc = () => {
    if (backgroundPersonalizationModal) {
      backgroundPersonalizationModal.style.display = 'none';
    }
  };

  if (closeBackgroundPersonalizationModal) {
    closeBackgroundPersonalizationModal.addEventListener('click', closeBackgroundPersonalizationModalFunc);
  }

  if (cancelBackgroundPersonalization) {
    cancelBackgroundPersonalization.addEventListener('click', closeBackgroundPersonalizationModalFunc);
  }

  // Cerrar modal al hacer clic fuera
  if (backgroundPersonalizationModal) {
    backgroundPersonalizationModal.addEventListener('click', (e) => {
      if (e.target === backgroundPersonalizationModal) {
        closeBackgroundPersonalizationModalFunc();
      }
    });
  }

  // Guardar personalización de fondo
  if (saveBackgroundPersonalizationBtn && autoBackgroundToggle) {
    saveBackgroundPersonalizationBtn.addEventListener('click', () => {
      const autoMode = autoBackgroundToggle.checked;
      setBackgroundAutoMode(autoMode);

      if (!autoMode) {
        // Si el modo automático está desactivado, guardar la imagen seleccionada
        const selectedItem = backgroundGallery?.querySelector('.background-gallery-item.active');
        if (selectedItem) {
          const imagePath = selectedItem.dataset.imagePath;
          setManualBackground(imagePath);
        } else {
          // Si no hay imagen seleccionada, usar la primera
          setManualBackground(PHOTOS[0]);
        }
      }

      // Actualizar el fondo inmediatamente
      setBackgroundImage();

      closeBackgroundPersonalizationModalFunc();
    });
  }

  // ========================================
  // Modal de API Keys
  // ========================================
  const apiKeysBtn = document.getElementById('api-keys-btn');
  const apiKeysModal = document.getElementById('api-keys-modal');
  const closeApiKeysModal = document.getElementById('close-api-keys-modal');
  const cancelApiKeys = document.getElementById('cancel-api-keys');
  const saveApiKeysBtn = document.getElementById('save-api-keys');
  const serperApiKeyInput = document.getElementById('serper-api-key-input');
  const gnewsApiKeyInput = document.getElementById('gnews-api-key-input');
  const mapboxApiKeyInput = document.getElementById('mapbox-api-key-input');
  const toggleSerperKey = document.getElementById('toggle-serper-key');
  const toggleGnewsKey = document.getElementById('toggle-gnews-key');
  const toggleMapboxKey = document.getElementById('toggle-mapbox-key');

  // Función para cargar API keys guardadas
  const loadApiKeys = () => {
    if (serperApiKeyInput) {
      serperApiKeyInput.value = localStorage.getItem('serper-api-key') || '';
    }
    if (gnewsApiKeyInput) {
      gnewsApiKeyInput.value = localStorage.getItem('gnews-api-key') || '';
    }
    if (mapboxApiKeyInput) {
      mapboxApiKeyInput.value = localStorage.getItem('mapbox-api-key') || '';
    }
  };

  // Abrir modal de API Keys
  if (apiKeysBtn) {
    apiKeysBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (apiKeysModal) {
        loadApiKeys();
        apiKeysModal.style.display = 'flex';
        if (settingsMenu) {
          settingsMenu.style.display = 'none';
        }
        userMenu.style.display = 'none';
        userCard.classList.remove('active');
      }
    });
  }

  // Cerrar modal de API Keys
  const closeApiKeysModalFunc = () => {
    if (apiKeysModal) {
      apiKeysModal.style.display = 'none';
    }
  };

  if (closeApiKeysModal) {
    closeApiKeysModal.addEventListener('click', closeApiKeysModalFunc);
  }

  if (cancelApiKeys) {
    cancelApiKeys.addEventListener('click', closeApiKeysModalFunc);
  }

  // Cerrar modal al hacer clic fuera
  if (apiKeysModal) {
    apiKeysModal.addEventListener('click', (e) => {
      if (e.target === apiKeysModal) {
        closeApiKeysModalFunc();
      }
    });
  }

  // Toggle para mostrar/ocultar API keys
  if (toggleSerperKey && serperApiKeyInput) {
    toggleSerperKey.addEventListener('click', () => {
      const type = serperApiKeyInput.type === 'password' ? 'text' : 'password';
      serperApiKeyInput.type = type;
      toggleSerperKey.classList.toggle('active', type === 'text');
    });
  }

  if (toggleGnewsKey && gnewsApiKeyInput) {
    toggleGnewsKey.addEventListener('click', () => {
      const type = gnewsApiKeyInput.type === 'password' ? 'text' : 'password';
      gnewsApiKeyInput.type = type;
      toggleGnewsKey.classList.toggle('active', type === 'text');
    });
  }

  if (toggleMapboxKey && mapboxApiKeyInput) {
    toggleMapboxKey.addEventListener('click', () => {
      const type = mapboxApiKeyInput.type === 'password' ? 'text' : 'password';
      mapboxApiKeyInput.type = type;
      toggleMapboxKey.classList.toggle('active', type === 'text');
    });
  }

  // Guardar API Keys
  if (saveApiKeysBtn) {
    saveApiKeysBtn.addEventListener('click', () => {
      const serperKey = serperApiKeyInput?.value.trim() || '';
      const gnewsKey = gnewsApiKeyInput?.value.trim() || '';
      const mapboxKey = mapboxApiKeyInput?.value.trim() || '';

      // Guardar o eliminar las keys según si están vacías
      if (serperKey) {
        localStorage.setItem('serper-api-key', serperKey);
      } else {
        localStorage.removeItem('serper-api-key');
      }

      if (gnewsKey) {
        localStorage.setItem('gnews-api-key', gnewsKey);
      } else {
        localStorage.removeItem('gnews-api-key');
      }

      if (mapboxKey) {
        localStorage.setItem('mapbox-api-key', mapboxKey);
        // Inicializar Mapbox si estamos en modo viajes
        if (state.chatMode === 'travel' && window.travelMode) {
          window.travelMode.init(mapboxKey);
        }
      } else {
        localStorage.removeItem('mapbox-api-key');
      }

      closeApiKeysModalFunc();
      console.log('🔑 API Keys guardadas correctamente');
    });
  }
}

// Sistema de temas
const THEME_STORAGE_KEY = 'ollama-web-theme';
const CUSTOM_THEME_KEY = 'ollama-web-custom-theme';

function getCurrentTheme() {
  if (!hasLocalStorage) return 'orange';
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) || 'orange';
  } catch (error) {
    console.warn('No se pudo obtener el tema', error);
    return 'orange';
  }
}

// Función para convertir hex a RGB
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

// Función para convertir RGB a hex
function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map(x => {
    const hex = x.toString(16);
    return hex.length === 1 ? "0" + hex : hex;
  }).join("");
}

// Función para oscurecer un color
function darkenColor(hex, percent) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const factor = 1 - (percent / 100);
  return rgbToHex(
    Math.round(rgb.r * factor),
    Math.round(rgb.g * factor),
    Math.round(rgb.b * factor)
  );
}

// Función para aclarar un color
function lightenColor(hex, percent) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const factor = percent / 100;
  return rgbToHex(
    Math.round(rgb.r + (255 - rgb.r) * factor),
    Math.round(rgb.g + (255 - rgb.g) * factor),
    Math.round(rgb.b + (255 - rgb.b) * factor)
  );
}

// Función para aplicar tema personalizado
function setCustomTheme(color) {
  if (!hasLocalStorage) return;
  try {
    const primary = color;
    const primaryDark = darkenColor(color, 15);
    const primaryLight = lightenColor(color, 20);

    // Guardar el color personalizado
    window.localStorage.setItem(CUSTOM_THEME_KEY, color);
    window.localStorage.setItem(THEME_STORAGE_KEY, 'custom');

    // Aplicar variables CSS dinámicamente
    const root = document.documentElement;
    root.style.setProperty('--theme-primary', primary);
    root.style.setProperty('--theme-primary-dark', primaryDark);
    root.style.setProperty('--theme-primary-light', primaryLight);

    // Calcular transparencias
    const rgb = hexToRgb(primary);
    if (rgb) {
      root.style.setProperty('--theme-primary-shadow', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.3)`);
      root.style.setProperty('--theme-primary-alpha-5', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.05)`);
      root.style.setProperty('--theme-primary-alpha-10', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.1)`);
      root.style.setProperty('--theme-primary-alpha-15', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.15)`);
      root.style.setProperty('--theme-primary-alpha-30', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.3)`);
      root.style.setProperty('--theme-primary-alpha-35', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.35)`);
    }

    document.documentElement.setAttribute('data-theme', 'custom');

    // Actualizar el botón de color personalizado para mostrar el color seleccionado
    const customColorBtn = document.getElementById('custom-color-btn');
    if (customColorBtn) {
      const colorDisplay = customColorBtn.querySelector('.theme-color-compact');
      if (colorDisplay) {
        colorDisplay.style.background = `linear-gradient(135deg, ${primary}, ${primaryDark})`;
        colorDisplay.textContent = '';
      }
    }

    // Actualizar favicon con el nuevo color
    setTimeout(updateFavicon, 50);
  } catch (error) {
    console.warn('No se pudo aplicar el tema personalizado', error);
  }
}

// Función para cargar tema personalizado guardado
function loadCustomTheme() {
  if (!hasLocalStorage) return;
  try {
    const customColor = window.localStorage.getItem(CUSTOM_THEME_KEY);
    const currentTheme = window.localStorage.getItem(THEME_STORAGE_KEY);

    if (customColor && currentTheme === 'custom') {
      setCustomTheme(customColor);
    }
  } catch (error) {
    console.warn('No se pudo cargar el tema personalizado', error);
  }
}

// Función para actualizar el favicon con el color del tema
function updateFavicon() {
  const themeColor = getComputedStyle(document.documentElement).getPropertyValue('--theme-primary').trim();

  const svg = `
    <svg viewBox="0 0 40 28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="4" width="8" height="6" fill="${themeColor}"/>
      <rect x="0" y="18" width="8" height="6" fill="${themeColor}"/>
      <rect x="8" y="11" width="8" height="6" fill="${themeColor}"/>
      <rect x="16" y="4" width="16" height="6" fill="${themeColor}"/>
      <rect x="16" y="18" width="16" height="6" fill="${themeColor}"/>
      <rect x="32" y="11" width="8" height="6" fill="${themeColor}"/>
    </svg>
  `;

  const favicon = document.querySelector('link[rel="icon"]');
  if (favicon) {
    favicon.href = 'data:image/svg+xml,' + encodeURIComponent(svg);
  }
}

function setTheme(themeName) {
  if (!hasLocalStorage) return;
  try {
    // Si se selecciona un tema predefinido, limpiar el tema personalizado
    if (themeName !== 'custom') {
      document.documentElement.style.removeProperty('--theme-primary');
      document.documentElement.style.removeProperty('--theme-primary-dark');
      document.documentElement.style.removeProperty('--theme-primary-light');
      document.documentElement.style.removeProperty('--theme-primary-shadow');
      document.documentElement.style.removeProperty('--theme-primary-alpha-5');
      document.documentElement.style.removeProperty('--theme-primary-alpha-10');
      document.documentElement.style.removeProperty('--theme-primary-alpha-15');
      document.documentElement.style.removeProperty('--theme-primary-alpha-30');
      document.documentElement.style.removeProperty('--theme-primary-alpha-35');
    }

    window.localStorage.setItem(THEME_STORAGE_KEY, themeName);
    document.documentElement.setAttribute('data-theme', themeName);

    // Si no es custom, cargar el tema personalizado guardado
    if (themeName === 'custom') {
      loadCustomTheme();
    }

    // Actualizar favicon con el nuevo color
    setTimeout(updateFavicon, 50);
  } catch (error) {
    console.warn('No se pudo guardar el tema', error);
  }
}

function initThemeSystem() {
  // Cargar tema guardado
  const savedTheme = getCurrentTheme();
  document.documentElement.setAttribute('data-theme', savedTheme);

  // Cargar tema personalizado si está guardado
  if (savedTheme === 'custom') {
    loadCustomTheme();
  }

  // Actualizar favicon inicial
  setTimeout(updateFavicon, 100);

  // Configurar modal de temas (por si se usa en el futuro)
  const settingsModal = document.getElementById('settings-modal');
  const closeSettingsModal = document.getElementById('close-settings-modal');
  const closeSettingsBtn = document.getElementById('close-settings-btn');

  const closeModal = () => {
    if (settingsModal) {
      settingsModal.style.display = 'none';
    }
  };

  if (closeSettingsModal) {
    closeSettingsModal.addEventListener('click', closeModal);
  }

  if (closeSettingsBtn) {
    closeSettingsBtn.addEventListener('click', closeModal);
  }

  // Cerrar modal al hacer clic fuera
  if (settingsModal) {
    settingsModal.addEventListener('click', (e) => {
      if (e.target === settingsModal) {
        closeModal();
      }
    });
  }

  // Manejar selección de temas en el modal (si existe)
  const themeOptions = settingsModal?.querySelectorAll('.theme-option');
  if (themeOptions) {
    themeOptions.forEach(option => {
      option.addEventListener('click', () => {
        const themeName = option.dataset.theme;
        if (themeName) {
          setTheme(themeName);

          // Actualizar estado visual en el modal
          themeOptions.forEach(opt => opt.classList.remove('active'));
          option.classList.add('active');

          // Actualizar estado visual en el submenú también
          const settingsMenu = document.getElementById('settings-menu');
          if (settingsMenu) {
            const compactOptions = settingsMenu.querySelectorAll('.theme-option-compact');
            compactOptions.forEach(opt => {
              if (opt.dataset.theme === themeName) {
                opt.classList.add('active');
              } else {
                opt.classList.remove('active');
              }
            });
          }
        }
      });
    });
  }

  // Manejar selección de temas en el submenú compacto
  const settingsMenu = document.getElementById('settings-menu');
  const compactThemeOptions = settingsMenu?.querySelectorAll('.theme-option-compact:not(.theme-custom-color)');
  if (compactThemeOptions) {
    compactThemeOptions.forEach(option => {
      option.addEventListener('click', () => {
        const themeName = option.dataset.theme;
        if (themeName) {
          setTheme(themeName);

          // Actualizar estado visual en el submenú
          compactThemeOptions.forEach(opt => opt.classList.remove('active'));
          option.classList.add('active');

          // Desactivar botón de color personalizado
          const customColorBtn = document.getElementById('custom-color-btn');
          if (customColorBtn) {
            customColorBtn.classList.remove('active');
          }

          // Actualizar estado visual en el modal también (si existe)
          if (settingsModal) {
            const modalOptions = settingsModal.querySelectorAll('.theme-option');
            modalOptions.forEach(opt => {
              if (opt.dataset.theme === themeName) {
                opt.classList.add('active');
              } else {
                opt.classList.remove('active');
              }
            });
          }
        }
      });
    });
  }

  // Manejar selector de color personalizado
  const customColorBtn = document.getElementById('custom-color-btn');
  const customColorPicker = document.getElementById('custom-color-picker');

  if (customColorBtn && customColorPicker) {
    // Cargar y mostrar el color personalizado guardado si existe
    const savedColor = localStorage.getItem(CUSTOM_THEME_KEY);
    if (savedColor && savedTheme === 'custom') {
      const colorDisplay = customColorBtn.querySelector('.theme-color-compact');
      if (colorDisplay) {
        const rgb = hexToRgb(savedColor);
        if (rgb) {
          const primaryDark = darkenColor(savedColor, 15);
          colorDisplay.style.background = `linear-gradient(135deg, ${savedColor}, ${primaryDark})`;
          colorDisplay.textContent = '';
        }
      }
      customColorBtn.classList.add('active');
    }

    // Abrir selector de color al hacer clic en el botón
    customColorBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Cargar color guardado si existe
      if (savedColor) {
        customColorPicker.value = savedColor;
      }
      customColorPicker.click();
    });

    // Aplicar color cuando se seleccione
    customColorPicker.addEventListener('change', (e) => {
      const selectedColor = e.target.value;
      setCustomTheme(selectedColor);

      // Actualizar estado visual en el submenú
      if (compactThemeOptions) {
        compactThemeOptions.forEach(opt => opt.classList.remove('active'));
        customColorBtn.classList.add('active');
      }

      // Actualizar estado visual en el modal también (si existe)
      if (settingsModal) {
        const modalOptions = settingsModal.querySelectorAll('.theme-option');
        modalOptions.forEach(opt => opt.classList.remove('active'));
      }
    });
  }
}

// ========================================
// Dashboard de Uso
// ========================================

const USAGE_STATS_KEY = 'ollama-web-usage-stats';

// Estructura para guardar estadísticas de uso
function getUsageStats() {
  if (!hasLocalStorage) return { modelUsage: {}, dailyMessages: {}, responseTimes: [] };
  try {
    const stored = window.localStorage.getItem(USAGE_STATS_KEY);
    return stored ? JSON.parse(stored) : { modelUsage: {}, dailyMessages: {}, responseTimes: [] };
  } catch (error) {
    console.warn('No se pudieron cargar las estadísticas de uso', error);
    return { modelUsage: {}, dailyMessages: {}, responseTimes: [] };
  }
}

function saveUsageStats(stats) {
  if (!hasLocalStorage) return;
  try {
    window.localStorage.setItem(USAGE_STATS_KEY, JSON.stringify(stats));
  } catch (error) {
    console.warn('No se pudieron guardar las estadísticas de uso', error);
  }
}

// Registrar uso de modelo
function trackModelUsage(modelName) {
  const stats = getUsageStats();
  if (!stats.modelUsage) stats.modelUsage = {};
  stats.modelUsage[modelName] = (stats.modelUsage[modelName] || 0) + 1;
  saveUsageStats(stats);
}

// Registrar mensaje diario
function trackDailyMessage() {
  const stats = getUsageStats();
  if (!stats.dailyMessages) stats.dailyMessages = {};
  const today = getTodayDateString();
  stats.dailyMessages[today] = (stats.dailyMessages[today] || 0) + 1;
  saveUsageStats(stats);
}

// Registrar tiempo de respuesta
function trackResponseTime(seconds) {
  const stats = getUsageStats();
  if (!stats.responseTimes) stats.responseTimes = [];
  // Guardar solo los últimos 100 tiempos de respuesta
  stats.responseTimes.push(seconds);
  if (stats.responseTimes.length > 100) {
    stats.responseTimes = stats.responseTimes.slice(-100);
  }
  saveUsageStats(stats);
}

// Calcular estadísticas generales
function calculateDashboardStats() {
  const conversations = Object.values(state.conversations);
  const stats = {
    totalMessages: 0,
    userMessages: 0,
    assistantMessages: 0,
    totalConversations: conversations.length,
    charsSent: 0,
    charsReceived: 0,
    filesAttached: 0,
    projectsCount: Object.keys(projectsState?.projects || {}).length,
    avgResponseTime: 0,
    tokensEstimated: 0,
    modelUsage: {},
    dailyMessages: {}
  };

  // Contar mensajes y caracteres de las conversaciones
  conversations.forEach(conv => {
    if (!conv.messages) return;

    conv.messages.forEach(msg => {
      stats.totalMessages++;
      const contentLength = msg.content?.length || 0;

      if (msg.role === 'user') {
        stats.userMessages++;
        stats.charsSent += contentLength;

        // Contar archivos adjuntos
        if (msg.attachedFiles && msg.attachedFiles.length > 0) {
          stats.filesAttached += msg.attachedFiles.length;
        }
      } else if (msg.role === 'assistant') {
        stats.assistantMessages++;
        stats.charsReceived += contentLength;
      }
    });
  });

  // Estimar tokens (1 token ≈ 4 caracteres en promedio)
  stats.tokensEstimated = Math.round((stats.charsSent + stats.charsReceived) / 4);

  // Obtener estadísticas guardadas
  const usageStats = getUsageStats();
  stats.modelUsage = usageStats.modelUsage || {};
  stats.dailyMessages = usageStats.dailyMessages || {};

  // Calcular tiempo promedio de respuesta
  if (usageStats.responseTimes && usageStats.responseTimes.length > 0) {
    const sum = usageStats.responseTimes.reduce((a, b) => a + b, 0);
    stats.avgResponseTime = (sum / usageStats.responseTimes.length).toFixed(1);
  }

  return stats;
}

// Formatear número grande
function formatNumber(num) {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
}

// Renderizar el gráfico de actividad
function renderActivityChart(dailyMessages) {
  const chartContainer = document.getElementById('activity-chart');
  if (!chartContainer) return;

  // Obtener los últimos 7 días
  const days = [];
  const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    days.push({
      date: dateStr,
      label: dayNames[date.getDay()],
      count: dailyMessages[dateStr] || 0
    });
  }

  const maxCount = Math.max(...days.map(d => d.count), 1);

  if (maxCount === 0 || days.every(d => d.count === 0)) {
    chartContainer.innerHTML = '<div class="activity-empty">No hay actividad registrada en los últimos 7 días</div>';
    return;
  }

  chartContainer.innerHTML = days.map(day => {
    const height = Math.max(4, (day.count / maxCount) * 80);
    return `
      <div class="activity-bar">
        <div class="activity-bar-fill" style="height: ${height}px" data-count="${day.count}"></div>
        <span class="activity-bar-label">${day.label}</span>
      </div>
    `;
  }).join('');
}

// Renderizar ranking de modelos
function renderModelsRanking(modelUsage) {
  const container = document.getElementById('models-ranking');
  if (!container) return;

  const models = Object.entries(modelUsage)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  if (models.length === 0) {
    container.innerHTML = '<div class="models-ranking-empty">No hay datos de uso de modelos aún</div>';
    return;
  }

  const maxCount = models[0].count;

  container.innerHTML = models.map((model, index) => {
    const positionClass = index === 0 ? 'gold' : index === 1 ? 'silver' : index === 2 ? 'bronze' : 'normal';
    const percentage = Math.round((model.count / maxCount) * 100);

    // Formatear nombre del modelo
    let displayName = model.name;
    if (model.name.includes(':')) {
      const parts = model.name.split(':');
      displayName = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
      if (parts[1]) {
        displayName += ' ' + parts[1].split('-')[0].toUpperCase();
      }
    }

    return `
      <div class="model-rank-item">
        <div class="model-rank-position ${positionClass}">${index + 1}</div>
        <div class="model-rank-info">
          <div class="model-rank-name">${escapeHtml(displayName)}</div>
          <div class="model-rank-count">${model.count} mensaje${model.count !== 1 ? 's' : ''}</div>
        </div>
        <div class="model-rank-bar">
          <div class="model-rank-bar-fill" style="width: ${percentage}%"></div>
        </div>
      </div>
    `;
  }).join('');
}

// Formatear tamaño de modelo
function formatModelSize(size) {
  if (!size) return 'Desconocido';
  const gb = size / (1024 * 1024 * 1024);
  if (gb >= 1) {
    return gb.toFixed(2) + ' GB';
  }
  const mb = size / (1024 * 1024);
  return mb.toFixed(2) + ' MB';
}

// Cargar información de modelos
async function loadModelsInfo() {
  const container = document.getElementById('models-info-list');
  if (!container) return;

  container.innerHTML = `
    <div class="models-loading">
      <div class="loading-spinner"></div>
      <span>Cargando información de modelos...</span>
    </div>
  `;

  try {
    const response = await fetch(`${API_BASE}/api/tags`);
    if (!response.ok) throw new Error('Error al cargar modelos');

    const data = await response.json();
    const models = data?.models ?? [];

    if (models.length === 0) {
      container.innerHTML = `
        <div class="models-empty">
          <div class="models-empty-icon">🤖</div>
          <p>No hay modelos instalados</p>
        </div>
      `;
      return;
    }

    container.innerHTML = models.map(model => {
      // Formatear nombre
      let displayName = model.name;
      if (model.name.includes(':')) {
        const parts = model.name.split(':');
        displayName = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
      }

      // Extraer información del modelo
      const details = model.details || {};
      const size = formatModelSize(model.size);
      const family = details.family || 'Desconocido';
      const parameterSize = details.parameter_size || 'N/A';
      const quantization = details.quantization_level || 'N/A';
      const format = details.format || 'N/A';

      // Detectar capacidades del modelo basándose en el nombre
      const capabilities = [];
      const nameLower = model.name.toLowerCase();
      if (nameLower.includes('vision') || nameLower.includes('llava')) {
        capabilities.push('Visión');
      }
      if (nameLower.includes('code') || nameLower.includes('coder') || nameLower.includes('codellama')) {
        capabilities.push('Código');
      }
      if (nameLower.includes('instruct') || nameLower.includes('chat')) {
        capabilities.push('Chat');
      }
      if (nameLower.includes('embed')) {
        capabilities.push('Embeddings');
      }
      if (nameLower.includes('deepseek') && nameLower.includes('r1')) {
        capabilities.push('Razonamiento');
      }
      if (nameLower.includes('math')) {
        capabilities.push('Matemáticas');
      }

      if (capabilities.length === 0) {
        capabilities.push('General');
      }

      return `
        <div class="model-info-card" data-model="${escapeHtml(model.name)}">
          <div class="model-info-header">
            <div class="model-info-title">
              <div class="model-info-icon">🤖</div>
              <div>
                <div class="model-info-name">${escapeHtml(displayName)}</div>
                <div class="model-info-size">${size}</div>
              </div>
            </div>
            <span class="model-info-chevron">▼</span>
          </div>
          <div class="model-info-details">
            <div class="model-detail-grid">
              <div class="model-detail-item">
                <div class="model-detail-label">Familia</div>
                <div class="model-detail-value">${escapeHtml(family)}</div>
              </div>
              <div class="model-detail-item">
                <div class="model-detail-label">Parámetros</div>
                <div class="model-detail-value highlight">${escapeHtml(parameterSize)}</div>
              </div>
              <div class="model-detail-item">
                <div class="model-detail-label">Cuantización</div>
                <div class="model-detail-value">${escapeHtml(quantization)}</div>
              </div>
              <div class="model-detail-item">
                <div class="model-detail-label">Formato</div>
                <div class="model-detail-value">${escapeHtml(format)}</div>
              </div>
            </div>
            <div class="model-capabilities">
              ${capabilities.map(cap => `<span class="model-capability-tag">${cap}</span>`).join('')}
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Añadir event listeners para expandir/colapsar
    container.querySelectorAll('.model-info-card').forEach(card => {
      const header = card.querySelector('.model-info-header');
      header?.addEventListener('click', () => {
        card.classList.toggle('expanded');
      });
    });

  } catch (error) {
    console.error('Error cargando modelos:', error);
    container.innerHTML = `
      <div class="models-empty">
        <div class="models-empty-icon">⚠️</div>
        <p>Error al cargar los modelos</p>
        <p style="font-size: 12px; opacity: 0.6;">Verifica que Ollama esté en ejecución</p>
      </div>
    `;
  }
}

// Actualizar estadísticas del dashboard
function updateDashboardStats() {
  const stats = calculateDashboardStats();

  // Actualizar valores en las tarjetas
  const elements = {
    'stat-total-messages': formatNumber(stats.totalMessages),
    'stat-total-conversations': formatNumber(stats.totalConversations),
    'stat-total-tokens': '~' + formatNumber(stats.tokensEstimated),
    'stat-avg-response-time': stats.avgResponseTime + 's',
    'stat-user-messages': formatNumber(stats.userMessages),
    'stat-assistant-messages': formatNumber(stats.assistantMessages),
    'stat-chars-sent': formatNumber(stats.charsSent),
    'stat-chars-received': formatNumber(stats.charsReceived),
    'stat-files-attached': formatNumber(stats.filesAttached),
    'stat-projects-count': formatNumber(stats.projectsCount)
  };

  Object.entries(elements).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  });

  // Renderizar gráfico de actividad
  renderActivityChart(stats.dailyMessages);

  // Renderizar ranking de modelos
  renderModelsRanking(stats.modelUsage);
}

// Abrir dashboard
function openDashboard() {
  const modal = document.getElementById('dashboard-modal');
  if (!modal) return;

  modal.style.display = 'flex';

  // Actualizar estadísticas
  updateDashboardStats();

  // Cargar información de modelos si está en esa pestaña
  const activeTab = modal.querySelector('.dashboard-tab.active');
  if (activeTab?.dataset.tab === 'models') {
    loadModelsInfo();
  }
}

// Cerrar dashboard
function closeDashboard() {
  const modal = document.getElementById('dashboard-modal');
  if (modal) {
    modal.style.display = 'none';
  }
}

// Inicializar dashboard
function initDashboard() {
  // Botón para abrir el dashboard
  const dashboardBtn = document.getElementById('dashboard-btn');
  dashboardBtn?.addEventListener('click', () => {
    // Cerrar menús
    const settingsMenu = document.getElementById('settings-menu');
    const userMenu = document.getElementById('user-menu');
    if (settingsMenu) settingsMenu.style.display = 'none';
    if (userMenu) userMenu.style.display = 'none';

    openDashboard();
  });

  // Botones para cerrar
  const closeBtn = document.getElementById('close-dashboard-modal');
  const closeBtn2 = document.getElementById('close-dashboard-modal-btn');

  closeBtn?.addEventListener('click', closeDashboard);
  closeBtn2?.addEventListener('click', closeDashboard);

  // Cerrar al hacer clic fuera
  const modal = document.getElementById('dashboard-modal');
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeDashboard();
  });

  // Pestañas
  const tabs = document.querySelectorAll('.dashboard-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Cambiar pestaña activa
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Cambiar contenido activo
      const tabName = tab.dataset.tab;
      document.querySelectorAll('.dashboard-content').forEach(content => {
        content.classList.remove('active');
      });
      const content = document.getElementById(`dashboard-${tabName}`);
      if (content) {
        content.classList.add('active');

        // Si es la pestaña de modelos, cargar la info
        if (tabName === 'models') {
          loadModelsInfo();
        }
      }
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  init();
  initBackgroundSystem();
  initUserMenu();
  initProjectSystem();
  initDashboard();
  initDeepResearch();
  initScreenOverlay();
  initSourceBadgeHandler(); // PDF source references click handler
  initPdfDatabase(); // Initialize IndexedDB for PDF storage
  
  // Ocultar toggle de búsqueda web por defecto (se muestra solo en modo web)
  const searchTypeToggle = document.querySelector('.web-search-type-toggle');
  if (searchTypeToggle) {
    searchTypeToggle.style.display = 'none';
  }
  
  try {
    initTranslationSystem();
  } catch (error) {
    console.warn('Translation system failed to initialize:', error);
  }
});

// Initialize click handler for source badges (PDF references)
function initSourceBadgeHandler() {
  document.addEventListener('click', (e) => {
    const badge = e.target.closest('.source-badge');
    if (!badge) return;

    e.preventDefault();
    e.stopPropagation();

    // Decode base64 encoded data
    const fileNameB64 = badge.dataset.fileB64;
    const citedTextB64 = badge.dataset.textB64;

    if (!fileNameB64) {
      console.warn('Source badge missing file data');
      return;
    }

    try {
      const fileName = decodeURIComponent(escape(atob(fileNameB64)));
      const citedText = citedTextB64 ? decodeURIComponent(escape(atob(citedTextB64))) : '';

      console.log('📄 Opening PDF viewer:', fileName, citedText);
      window.openPdfViewer(fileName, citedText);
    } catch (err) {
      console.error('Error decoding source badge data:', err);
    }
  });
}

// ========================================
// Project System
// ========================================
const PROJECTS_STORAGE_KEY = 'ollama-web-projects';

// Project state
const projectsState = {
  projects: {},
  activeProjectId: null,
  editingProjectId: null,
  tempProjectFiles: [] // Archivos temporales mientras se edita/crea
};

function getProjects() {
  if (!hasLocalStorage) return {};
  try {
    const stored = window.localStorage.getItem(PROJECTS_STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch (error) {
    console.warn('No se pudieron cargar los proyectos', error);
    return {};
  }
}

function saveProjects(projects) {
  if (!hasLocalStorage) return;
  try {
    window.localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects));
  } catch (error) {
    console.warn('No se pudieron guardar los proyectos', error);
  }
}

function loadProjectsState() {
  projectsState.projects = getProjects();

  // Limpiar proyectos corruptos o con estructura incompleta
  Object.keys(projectsState.projects).forEach(id => {
    const project = projectsState.projects[id];
    if (!project || typeof project !== 'object') {
      delete projectsState.projects[id];
      return;
    }
    // Asegurar que tenga todas las propiedades necesarias
    if (!project.files) project.files = [];
    if (!project.conversationIds) project.conversationIds = [];
    if (!project.name) project.name = 'Proyecto sin nombre';
    if (!project.instructions) project.instructions = '';
  });

  // Guardar proyectos limpios
  saveProjects(projectsState.projects);

  // Cargar proyecto activo si había uno guardado
  if (hasLocalStorage) {
    try {
      const activeProjectId = window.localStorage.getItem('ollama-web-active-project');
      if (activeProjectId && projectsState.projects[activeProjectId]) {
        projectsState.activeProjectId = activeProjectId;
      }
    } catch (error) {
      console.warn('No se pudo cargar el proyecto activo', error);
    }
  }
}

function saveActiveProject(projectId) {
  if (!hasLocalStorage) return;
  try {
    if (projectId) {
      window.localStorage.setItem('ollama-web-active-project', projectId);
    } else {
      window.localStorage.removeItem('ollama-web-active-project');
    }
  } catch (error) {
    console.warn('No se pudo guardar el proyecto activo', error);
  }
}

function createProject(name, instructions, files = []) {
  const id = generateId('proj');
  const project = {
    id,
    name: name.trim() || 'Proyecto sin nombre',
    instructions: instructions.trim(),
    files: files.map(f => ({
      id: f.id || generateId('pfile'),
      name: f.name,
      size: f.size,
      type: f.type,
      content: f.content,
      isImage: f.isImage || false,
      isPDF: f.isPDF || false,
      hasPdfBinary: f.hasPdfBinary || false
    })),
    conversationIds: [], // IDs de conversaciones asociadas
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  projectsState.projects[id] = project;
  saveProjects(projectsState.projects);
  return project;
}

function updateProject(projectId, updates) {
  const project = projectsState.projects[projectId];
  if (!project) return null;

  if (updates.name !== undefined) project.name = updates.name.trim() || 'Proyecto sin nombre';
  if (updates.instructions !== undefined) project.instructions = updates.instructions.trim();
  if (updates.files !== undefined) {
    project.files = updates.files.map(f => ({
      id: f.id || generateId('pfile'),
      name: f.name,
      size: f.size,
      type: f.type,
      content: f.content,
      isImage: f.isImage || false,
      isPDF: f.isPDF || false,
      hasPdfBinary: f.hasPdfBinary || false
    }));
  }

  project.updatedAt = Date.now();
  saveProjects(projectsState.projects);
  return project;
}

function deleteProject(projectId) {
  const project = projectsState.projects[projectId];
  if (!project) return false;

  // Eliminar conversaciones asociadas al proyecto
  project.conversationIds.forEach(convId => {
    if (state.conversations[convId]) {
      delete state.conversations[convId];
      state.order = state.order.filter(id => id !== convId);
    }
  });

  // Si era el proyecto activo, desactivarlo
  if (projectsState.activeProjectId === projectId) {
    projectsState.activeProjectId = null;
    saveActiveProject(null);
    updateProjectBadge();
  }

  delete projectsState.projects[projectId];
  saveProjects(projectsState.projects);
  persistState();

  return true;
}

function setActiveProject(projectId) {
  if (projectId && !projectsState.projects[projectId]) return false;

  projectsState.activeProjectId = projectId;
  saveActiveProject(projectId);
  updateProjectBadge();
  renderProjectsList();

  // Actualizar clase del chat-state
  const chatState = document.getElementById('chat-state');
  if (chatState) {
    if (projectId) {
      chatState.classList.add('in-project');
    } else {
      chatState.classList.remove('in-project');
    }
  }

  // Si hay un proyecto activo, crear una nueva conversación para él
  if (projectId) {
    createProjectConversation(projectId);
  }

  return true;
}

function createProjectConversation(projectId) {
  const project = projectsState.projects[projectId];
  if (!project) return null;

  // Crear nueva conversación
  const convId = generateId('conv');
  const conversation = {
    id: convId,
    title: `${project.name} - ${window.translationManager ? window.translationManager.translate('chat.newConversation') : 'Nueva conversación'}`,
    projectId: projectId, // Asociar con el proyecto
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  };

  state.conversations[convId] = conversation;
  attachedFiles[convId] = [];

  // Añadir a la lista de conversaciones del proyecto
  project.conversationIds.push(convId);
  saveProjects(projectsState.projects);

  touchConversation(convId);
  setActiveConversation(convId);

  return conversation;
}

function getActiveProject() {
  if (!projectsState.activeProjectId) return null;
  return projectsState.projects[projectsState.activeProjectId] || null;
}

function buildProjectContext(project) {
  if (!project) return '';

  let context = '';

  // Añadir advertencia importante al inicio
  context += `⚠️ REGLA CRÍTICA: Estás trabajando en el proyecto "${project.name}". 
DEBES basar tus respuestas ÚNICAMENTE en los documentos proporcionados a continuación.
Si la información no está en los documentos, responde "No encuentro esa información en los documentos del proyecto" en lugar de inventar.
NO inventes fuentes ni información que no esté en los documentos.

`;

  // Añadir instrucciones del proyecto
  if (project.instructions) {
    context += `══════════════════════════════════════════════════════════════\n`;
    context += `📋 INSTRUCCIONES DEL PROYECTO: "${project.name}"\n`;
    context += `══════════════════════════════════════════════════════════════\n\n`;
    context += `${project.instructions}\n\n`;
  }

  // Añadir contenido de archivos del proyecto (solo texto/PDF, no imágenes)
  const textFiles = (project.files || []).filter(f => !f.isImage);
  if (textFiles.length > 0) {
    context += `=== DOCUMENTOS DEL PROYECTO (DEBES LEER Y USAR ESTE CONTENIDO) ===\n\n`;

    textFiles.forEach((file, index) => {
      const contentLength = file.content?.length || 0;
      console.log(`📂 Proyecto - Incluyendo archivo ${index + 1}: ${file.name} (${contentLength} caracteres)`);

      context += `══════════════════════════════════════════════════════════════\n`;
      context += `📄 DOCUMENTO ${index + 1}: ${file.name}\n`;
      context += `══════════════════════════════════════════════════════════════\n\n`;
      context += `${file.content}\n\n`;
    });

    context += `=== FIN DE DOCUMENTOS DEL PROYECTO ===\n\n`;
  }

  if (context) {
    context += `
═══════════════════════════════════════════════════════════════
📌 INSTRUCCIONES DE CITACIÓN Y USO DE DOCUMENTOS
═══════════════════════════════════════════════════════════════

IMPORTANTE: Debes seguir las instrucciones del proyecto y USAR el contenido de los documentos proporcionados para responder las preguntas del usuario.

FORMATO DE CITAS OBLIGATORIO:
Cuando uses información de los documentos del proyecto, DEBES incluir referencias inline usando este formato EXACTO:
[[FUENTE:nombre_del_archivo.pdf:"texto citado del documento"]]

EJEMPLOS DE USO CORRECTO:
- "La paginación simple utiliza un solo nivel [[FUENTE:T1.-Gestion-de-Memoria.pdf:"paginación simple o de un nivel"]]"
- "El tamaño de marco es de 4KB [[FUENTE:memoria.pdf:"el tamaño del marco de página es 4096 bytes"]]"

REGLAS DE CITACIÓN:
1. Cita fragmentos EXACTOS que aparecen en el documento (pueden ser frases cortas de 3-10 palabras)
2. El nombre del archivo debe coincidir EXACTAMENTE con el nombre en los documentos
3. Incluye múltiples citas si usas información de varias partes del documento
4. Las citas deben aparecer JUSTO DESPUÉS de la información que respaldan
5. No inventes citas - solo cita texto que realmente existe en los documentos

`;
  }

  return context;
}

function updateProjectBadge() {
  // Badge en el chat header
  const badge = document.getElementById('project-badge');
  const badgeName = document.getElementById('project-badge-name');

  // Badge en el empty state (pantalla principal)
  const badgeEmpty = document.getElementById('project-badge-empty');
  const badgeNameEmpty = document.getElementById('project-badge-name-empty');

  // Botón de proyectos en sidebar (para modo minimizado)
  const projectsBtn = document.getElementById('projects-panel-btn');

  const project = getActiveProject();

  if (project) {
    // Mostrar badge en chat header
    if (badge && badgeName) {
      badgeName.textContent = project.name;
      badge.style.display = 'flex';
    }
    // Mostrar badge en empty state
    if (badgeEmpty && badgeNameEmpty) {
      badgeNameEmpty.textContent = project.name;
      badgeEmpty.style.display = 'flex';
    }

    // Marcar el botón de proyectos como activo (naranja en modo minimizado)
    if (projectsBtn) {
      projectsBtn.classList.add('has-active-project');
      projectsBtn.setAttribute('data-active-project', 'Proyecto');
      projectsBtn.setAttribute('title', 'Proyecto');
    }

    // Actualizar indicadores compactos de contexto
    updateCompactContextIndicators(project);
  } else {
    // Ocultar ambos badges
    if (badge) badge.style.display = 'none';
    if (badgeEmpty) badgeEmpty.style.display = 'none';

    // Quitar clase activa del botón de proyectos
    if (projectsBtn) {
      projectsBtn.classList.remove('has-active-project');
      projectsBtn.removeAttribute('data-active-project');
      projectsBtn.setAttribute('title', 'Proyectos');
    }
  }
}

// Actualizar los indicadores compactos de contexto en los badges
async function updateCompactContextIndicators(project) {
  if (!project) return;

  try {
    // Obtener info del modelo actual
    const currentModel = state.currentModel;
    if (!currentModel) return;

    const modelInfo = await getModelContextInfo(currentModel);
    const contextLength = modelInfo?.contextLength || MODEL_CONTEXT_DEFAULTS?.default || 4096;

    // Calcular tokens del proyecto
    const tokenUsage = calculateProjectTokens(project.instructions || '', project.files || []);
    const chatReserve = 2000;
    const totalWithReserve = tokenUsage.total + chatReserve;
    const usagePercent = Math.min(100, Math.round((totalWithReserve / contextLength) * 100));

    // Actualizar ambos indicadores (chat header y empty state)
    const indicators = [
      {
        fill: document.getElementById('context-mini-fill'),
        text: document.getElementById('context-mini-text')
      },
      {
        fill: document.getElementById('context-mini-fill-empty'),
        text: document.getElementById('context-mini-text-empty')
      }
    ];

    indicators.forEach(({ fill, text }) => {
      if (fill) {
        fill.style.width = `${usagePercent}%`;
        fill.classList.remove('warning', 'danger', 'critical');
        if (usagePercent >= 100) {
          fill.classList.add('critical');
        } else if (usagePercent >= 85) {
          fill.classList.add('danger');
        } else if (usagePercent >= 70) {
          fill.classList.add('warning');
        }
      }

      if (text) {
        text.textContent = `${usagePercent}%`;
        text.classList.remove('warning', 'danger', 'critical');
        if (usagePercent >= 100) {
          text.classList.add('critical');
        } else if (usagePercent >= 85) {
          text.classList.add('danger');
        } else if (usagePercent >= 70) {
          text.classList.add('warning');
        }
      }
    });
  } catch (error) {
    console.warn('Error al actualizar indicadores de contexto:', error);
  }
}

function renderProjectsList() {
  const listElement = document.getElementById('projects-list');
  if (!listElement) return;

  const projects = Object.values(projectsState.projects);

  if (projects.length === 0) {
    listElement.innerHTML = `
        <div style="text-align: center; padding: 20px; color: var(--text-secondary);">
        ${window.translationManager ? window.translationManager.translate('sidebar.noProjects') : 'No hay proyectos aún.'}<br>
        <span style="font-size: 11px; opacity: 0.7;">${window.translationManager ? window.translationManager.translate('sidebar.createProjectHint') : 'Crea uno para organizar tus chats'}</span>
        </div>
      `;
    return;
  }

  // Ordenar por fecha de actualización (más reciente primero)
  projects.sort((a, b) => b.updatedAt - a.updatedAt);

  listElement.innerHTML = projects.map(project => {
    const isActive = project.id === projectsState.activeProjectId;
    const fileCount = (project.files || []).length;
    const convCount = (project.conversationIds || []).length;


    return `
      <li class="project-item ${isActive ? 'active' : ''}" data-project-id="${project.id}" data-project-name="${escapeHtml(project.name || 'Sin nombre')}">
        <div class="project-item-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg></div>
        <div class="project-item-info">
          <p class="project-item-name">${escapeHtml(project.name || 'Sin nombre')}</p>
          <p class="project-item-meta">${fileCount} archivo${fileCount !== 1 ? 's' : ''}</p>
        </div>
        <div class="project-item-actions">
          <button class="project-action-btn edit" title="Editar proyecto" data-action="edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>
          <button class="project-action-btn delete" title="Eliminar proyecto" data-action="delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
        </div>
      </li>
    `;
  }).join('');

  // Añadir event listeners
  listElement.querySelectorAll('.project-item').forEach(item => {
    const projectId = item.dataset.projectId;

    // Click en el item para activar el proyecto
    item.addEventListener('click', (e) => {
      if (e.target.closest('.project-action-btn')) return; // Ignorar clicks en botones de acción
      setActiveProject(projectId);
    });

    // Botón editar
    const editBtn = item.querySelector('.project-action-btn.edit');
    editBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      openProjectModal(projectId);
    });

    // Botón eliminar
    const deleteBtn = item.querySelector('.project-action-btn.delete');
    deleteBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      openDeleteProjectModal(projectId);
    });
  });
}

function renderProjectFiles() {
  const listElement = document.getElementById('project-files-list');
  if (!listElement) return;

  if (projectsState.tempProjectFiles.length === 0) {
    listElement.innerHTML = '';
    return;
  }

  listElement.innerHTML = projectsState.tempProjectFiles.map(file => {
    const ext = getFileExtension(file.name);
    const size = formatFileSize(file.size);

    return `
      <div class="project-file-item" data-file-id="${file.id}">
        <div class="project-file-icon">${ext}</div>
        <div class="project-file-info">
          <div class="project-file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</div>
          <div class="project-file-size">${size}</div>
        </div>
        <button class="project-file-remove" title="Eliminar archivo" data-file-id="${file.id}">×</button>
      </div>
    `;
  }).join('');

  // Añadir event listeners para eliminar
  listElement.querySelectorAll('.project-file-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const fileId = btn.dataset.fileId;
      projectsState.tempProjectFiles = projectsState.tempProjectFiles.filter(f => f.id !== fileId);
      renderProjectFiles();
      // Actualizar info de contexto después de eliminar
      if (typeof updateProjectContextInfo === 'function') {
        updateProjectContextInfo();
      }
    });
  });
}

function openProjectModal(projectId = null) {
  const modal = document.getElementById('project-modal');
  const title = document.getElementById('project-modal-title');
  const nameInput = document.getElementById('project-name-input');
  const instructionsInput = document.getElementById('project-instructions-input');

  if (!modal || !nameInput || !instructionsInput) return;

  projectsState.editingProjectId = projectId;

  if (projectId) {
    // Modo edición
    const project = projectsState.projects[projectId];
    if (!project) return;

    title.textContent = 'Editar Proyecto';
    nameInput.value = project.name;
    instructionsInput.value = project.instructions;
    projectsState.tempProjectFiles = [...project.files];
  } else {
    // Modo creación
    title.textContent = 'Nuevo Proyecto';
    nameInput.value = '';
    instructionsInput.value = '';
    projectsState.tempProjectFiles = [];
  }

  renderProjectFiles();
  modal.style.display = 'flex';
  setTimeout(() => {
    nameInput.focus();
    // Actualizar info de contexto cuando se abre el modal
    if (typeof updateProjectContextInfo === 'function') {
      updateProjectContextInfo();
    }
  }, 100);
}

function closeProjectModal() {
  const modal = document.getElementById('project-modal');
  if (modal) {
    modal.style.display = 'none';
  }
  projectsState.editingProjectId = null;
  projectsState.tempProjectFiles = [];
}

function saveProjectFromModal() {
  const nameInput = document.getElementById('project-name-input');
  const instructionsInput = document.getElementById('project-instructions-input');

  if (!nameInput || !instructionsInput) return;

  const name = nameInput.value.trim();
  const instructions = instructionsInput.value.trim();
  const files = [...projectsState.tempProjectFiles];

  if (!name) {
    nameInput.focus();
    return;
  }

  if (projectsState.editingProjectId) {
    // Actualizar proyecto existente
    updateProject(projectsState.editingProjectId, { name, instructions, files });
  } else {
    // Crear nuevo proyecto
    createProject(name, instructions, files);
  }

  closeProjectModal();
  renderProjectsList();
  updateProjectBadge();
}

function openDeleteProjectModal(projectId) {
  const modal = document.getElementById('delete-project-modal');
  const nameElement = document.getElementById('delete-project-name');

  if (!modal || !nameElement) return;

  const project = projectsState.projects[projectId];
  if (!project) return;

  projectsState.editingProjectId = projectId;
  nameElement.textContent = project.name;
  modal.style.display = 'flex';
}

function closeDeleteProjectModal() {
  const modal = document.getElementById('delete-project-modal');
  if (modal) {
    modal.style.display = 'none';
  }
  projectsState.editingProjectId = null;
}

function confirmDeleteProject() {
  if (projectsState.editingProjectId) {
    deleteProject(projectsState.editingProjectId);
    renderProjectsList();
    renderConversationList();

    // Si no hay conversación activa, crear una nueva
    if (!state.activeId || !state.conversations[state.activeId]) {
      if (state.order.length > 0) {
        setActiveConversation(state.order[0]);
      } else {
        createConversation();
      }
    }
  }
  closeDeleteProjectModal();
}

async function handleProjectFiles(files) {
  const fileArray = Array.from(files);

  for (const file of fileArray) {
    try {
      // Límite de tamaño
      if (file.size > 50 * 1024 * 1024) {
        alert(window.translationManager
          ? window.translationManager.translate('error.genericFileTooLarge', { name: file.name })
          : `El archivo ${file.name} es demasiado grande. El tamaño máximo es 50MB.`);
        continue;
      }

      const isPDF = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      console.log(`📂 Proyecto - Procesando archivo: ${file.name} (${isPDF ? 'PDF' : 'texto'})`);

      const content = await readFileContent(file);
      const isImage = isImageFile(file);

      // Log de depuración para verificar el contenido extraído
      console.log(`📂 Proyecto - Archivo procesado: ${file.name}`);
      console.log(`   - Tipo: ${isImage ? 'Imagen' : (isPDF ? 'PDF' : 'Texto')}`);

      // Para PDFs, content es un objeto { text, binary, isPdfData }
      if (content && content.isPdfData) {
        const fileId = generateId('pfile');
        console.log(`   - Texto extraído: ${content.text?.length || 0} caracteres`);

        // Save PDF binary to IndexedDB (avoids localStorage size limits)
        let pdfStored = false;
        if (content.binary) {
          pdfStored = await savePdfToIndexedDB(fileId, content.binary);
          console.log(`   - Binario PDF: ${pdfStored ? 'Guardado en IndexedDB' : 'Error al guardar'}`);
        }

        projectsState.tempProjectFiles.push({
          id: fileId,
          name: file.name,
          size: file.size,
          type: file.type,
          content: content.text,           // Texto para el contexto de la IA (localStorage)
          hasPdfBinary: pdfStored,          // Flag indicating PDF is in IndexedDB
          isImage: false,
          isPDF: true
        });
      } else {
        console.log(`   - Contenido extraído: ${content?.length || 0} caracteres`);
        if (!isImage && content) {
          console.log(`   - Primeros 200 chars: ${content.substring(0, 200)}...`);
        }

        projectsState.tempProjectFiles.push({
          id: generateId('pfile'),
          name: file.name,
          size: file.size,
          type: file.type,
          content: content,
          isImage: isImage
        });
      }
    } catch (error) {
      console.error(`Error al leer el archivo ${file.name}:`, error);
      alert(window.translationManager
        ? window.translationManager.translate('error.fileReadError', { name: file.name, error: error.message })
        : `Error al leer el archivo ${file.name}: ${error.message}`);
    }
  }

  renderProjectFiles();

  // Actualizar info de contexto después de añadir archivos
  if (typeof updateProjectContextInfo === 'function') {
    updateProjectContextInfo();
  }
}

function initProjectSystem() {
  loadProjectsState();
  renderProjectsList();
  updateProjectBadge();

  // Botón nuevo proyecto
  const newProjectBtn = document.getElementById('new-project-btn');
  if (newProjectBtn) {
    newProjectBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openProjectModal();
    });
  }

  // Modal de proyecto
  const closeProjectModalBtn = document.getElementById('close-project-modal');
  const cancelProjectBtn = document.getElementById('cancel-project');
  const saveProjectBtn = document.getElementById('save-project');

  closeProjectModalBtn?.addEventListener('click', closeProjectModal);
  cancelProjectBtn?.addEventListener('click', closeProjectModal);
  saveProjectBtn?.addEventListener('click', saveProjectFromModal);

  // Modal de proyecto - cerrar al hacer clic fuera
  const projectModal = document.getElementById('project-modal');
  projectModal?.addEventListener('click', (e) => {
    if (e.target === projectModal) {
      closeProjectModal();
    }
  });

  // Modal de eliminar proyecto
  const closeDeleteBtn = document.getElementById('close-delete-project-modal');
  const cancelDeleteBtn = document.getElementById('cancel-delete-project');
  const confirmDeleteBtn = document.getElementById('confirm-delete-project');

  closeDeleteBtn?.addEventListener('click', closeDeleteProjectModal);
  cancelDeleteBtn?.addEventListener('click', closeDeleteProjectModal);
  confirmDeleteBtn?.addEventListener('click', confirmDeleteProject);

  // Modal de eliminar - cerrar al hacer clic fuera
  const deleteModal = document.getElementById('delete-project-modal');
  deleteModal?.addEventListener('click', (e) => {
    if (e.target === deleteModal) {
      closeDeleteProjectModal();
    }
  });

  // Dropzone de archivos del proyecto
  const dropzone = document.getElementById('project-files-dropzone');
  const fileInput = document.getElementById('project-file-input');

  if (dropzone && fileInput) {
    dropzone.addEventListener('click', () => fileInput.click());

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('drag-over');
    });

    dropzone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('drag-over');
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('drag-over');

      if (e.dataTransfer.files.length > 0) {
        handleProjectFiles(e.dataTransfer.files);
      }
    });

    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        handleProjectFiles(e.target.files);
        e.target.value = ''; // Reset
      }
    });
  }

  // Botón salir del proyecto (en chat header)
  const exitProjectBtn = document.getElementById('exit-project-btn');
  exitProjectBtn?.addEventListener('click', () => {
    setActiveProject(null);
  });

  // Botón salir del proyecto (en empty state)
  const exitProjectBtnEmpty = document.getElementById('exit-project-btn-empty');
  exitProjectBtnEmpty?.addEventListener('click', () => {
    setActiveProject(null);
  });

  // Si había un proyecto activo, actualizarlo
  if (projectsState.activeProjectId) {
    updateProjectBadge();

    // Actualizar clase del chat-state
    const chatState = document.getElementById('chat-state');
    if (chatState) {
      chatState.classList.add('in-project');
    }
  }

  // Inicializar sistema de información de contexto
  initProjectContextInfo();

  // Inicializar panel de proyectos (nuevo sistema)
  initProjectsPanel();
}

// ========================================
// Panel de Proyectos (estilo Claude)
// ========================================

let projectsPanelVisible = false;
let projectDetailViewId = null;
let projectsSearchTerm = '';
let projectsSortBy = 'activity';

function initProjectsPanel() {
  // Botón de proyectos en el sidebar
  const projectsPanelBtn = document.getElementById('projects-panel-btn');
  if (projectsPanelBtn) {
    projectsPanelBtn.addEventListener('click', () => {
      toggleProjectsPanel();
    });
  }

  // Botón nuevo proyecto desde el panel
  const newProjectFromPanelBtn = document.getElementById('new-project-from-panel-btn');
  if (newProjectFromPanelBtn) {
    newProjectFromPanelBtn.addEventListener('click', () => {
      openProjectModal();
    });
  }

  // Búsqueda de proyectos
  const searchInput = document.getElementById('projects-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      projectsSearchTerm = e.target.value.toLowerCase();
      renderProjectsPanelGrid();
    });
  }

  // Ordenación de proyectos
  const sortSelect = document.getElementById('projects-sort-select');
  if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
      projectsSortBy = e.target.value;
      renderProjectsPanelGrid();
    });
  }

  // Botón volver a todos los proyectos
  const backBtn = document.getElementById('back-to-projects-btn');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      closeProjectDetailView();
    });
  }

  // Botón editar instrucciones del proyecto
  const editInstructionsBtn = document.getElementById('project-edit-instructions-btn');
  if (editInstructionsBtn) {
    editInstructionsBtn.addEventListener('click', () => {
      if (projectDetailViewId) {
        openProjectModal(projectDetailViewId);
      }
    });
  }

  // Botón añadir archivos del proyecto
  const addFilesBtn = document.getElementById('project-add-files-btn');
  if (addFilesBtn) {
    addFilesBtn.addEventListener('click', () => {
      if (projectDetailViewId) {
        openProjectModal(projectDetailViewId);
      }
    });
  }

  // Input del proyecto
  const projectPromptInput = document.getElementById('project-prompt-input');
  if (projectPromptInput) {
    projectPromptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendProjectMessage();
      }
    });

    // Auto-resize
    projectPromptInput.addEventListener('input', () => {
      projectPromptInput.style.height = 'auto';
      projectPromptInput.style.height = Math.min(projectPromptInput.scrollHeight, 200) + 'px';
    });
  }

  // Botón enviar del proyecto
  const projectSendBtn = document.getElementById('project-send-btn');
  if (projectSendBtn) {
    projectSendBtn.addEventListener('click', () => {
      sendProjectMessage();
    });
  }

  // Llenar el selector de modelos del proyecto
  populateProjectModelSelect();

  // Inicializar toggle de modos del proyecto
  initProjectChatModeToggle();
}

// Inicializar toggle de modos para el chat del proyecto
function initProjectChatModeToggle() {
  const toggle = document.getElementById('project-chat-mode-toggle');
  if (!toggle) return;

  const options = toggle.querySelectorAll('.chat-mode-option');
  const slider = toggle.querySelector('.chat-mode-slider');

  // Usar el mismo modo que el chat principal por defecto
  let activeMode = state.chatMode || 'normal';

  // Marcar el botón activo
  options.forEach((option, index) => {
    if (option.dataset.mode === activeMode) {
      option.classList.add('active');
      if (slider) {
        slider.style.left = `${index * 32}px`;
      }
    } else {
      option.classList.remove('active');
    }

    option.addEventListener('click', () => {
      // Quitar active de todos
      options.forEach(opt => opt.classList.remove('active'));
      option.classList.add('active');

      // Mover slider
      const optionIndex = Array.from(options).indexOf(option);
      if (slider) {
        slider.style.left = `${optionIndex * 32}px`;
      }

      // Establecer modo
      const mode = option.dataset.mode;
      state.chatMode = mode;

      // Sincronizar con los otros toggles
      syncChatModeToggles(mode);

      // Mostrar/ocultar panel de viajes
      handleTravelMode(mode);
    });
  });
}

// Manejar el modo viajes - ahora con mapas inline en el chat
function handleTravelMode(mode) {
  const travelPanel = document.getElementById('travel-panel');
  const emptyState = document.getElementById('empty-state');
  const chatState = document.getElementById('chat-state');
  const projectsPanel = document.getElementById('projects-panel');
  const newsPanel = document.getElementById('news-panel');

  // El panel de viajes antiguo siempre permanece oculto
  // Los mapas ahora aparecen inline en el chat
  if (travelPanel) {
    travelPanel.style.display = 'none';
  }

  if (mode === 'travel') {
    // Ocultar otros paneles pero MANTENER el chat visible
    // Los mapas aparecerán inline en los mensajes del chat
    if (projectsPanel) projectsPanel.style.display = 'none';
    if (newsPanel) newsPanel.style.display = 'none';

    // Inicializar el módulo de viajes si está disponible
    if (window.travelMode && typeof window.travelMode.init === 'function') {
      const mapboxApiKey = localStorage.getItem('mapbox-api-key');
      window.travelMode.init(mapboxApiKey);
    }

    // Mostrar el chat o empty state (los mapas irán inline)
    if (state.activeId && state.conversations[state.activeId]) {
      if (chatState) chatState.style.display = 'flex';
      if (emptyState) emptyState.style.display = 'none';
    } else {
      if (emptyState) emptyState.style.display = 'flex';
      if (chatState) chatState.style.display = 'none';
    }
  } else {
    // Mostrar el chat o empty state según corresponda
    if (state.activeId && state.conversations[state.activeId]) {
      if (chatState) chatState.style.display = 'flex';
      if (emptyState) emptyState.style.display = 'none';
    } else {
      if (emptyState) emptyState.style.display = 'flex';
      if (chatState) chatState.style.display = 'none';
    }
  }
}

// Sincronizar todos los toggles de modo de chat
function syncChatModeToggles(mode) {
  const toggles = document.querySelectorAll('.chat-mode-toggle');
  const visibleModes = getVisibleChatModes();
  
  toggles.forEach(toggle => {
    toggle.setAttribute('data-active-mode', mode);
    const options = toggle.querySelectorAll('.chat-mode-option');
    
    // Construir lista de modos visibles en orden y actualizar visibilidad
    const visibleModesList = [];
    options.forEach(option => {
      const optMode = option.dataset.mode;
      // Si es el modo activo actual, SIEMPRE mostrarlo aunque no esté en la lista de visibles
      const isVisible = visibleModes.includes(optMode) || optMode === mode;
      option.style.display = isVisible ? '' : 'none';
      if (isVisible) {
        visibleModesList.push(optMode);
      }
    });

    options.forEach((option, index) => {
      if (option.dataset.mode === mode) {
        option.classList.add('active');
      } else {
        option.classList.remove('active');
      }
    });
    
    // Actualizar posición del slider con modos visibles
    updateSliderPosition(toggle, visibleModesList);
  });
}



// Inicializar drag & drop para archivos del proyecto
function initProjectFilesDragDrop() {
  // Usamos event delegation en el project-sidebar
  const sidebar = document.querySelector('.project-sidebar');
  if (!sidebar) return;

  // Prevenir comportamiento por defecto
  sidebar.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const filesSection = sidebar.querySelector('.project-files-section');
    if (filesSection) {
      filesSection.classList.add('drag-over');
    }
  });

  sidebar.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const filesSection = sidebar.querySelector('.project-files-section');
    if (filesSection && !filesSection.contains(e.relatedTarget)) {
      filesSection.classList.remove('drag-over');
    }
  });

  sidebar.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();

    const filesSection = sidebar.querySelector('.project-files-section');
    if (filesSection) {
      filesSection.classList.remove('drag-over');
    }

    if (!projectDetailViewId) return;

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleProjectFileDrop(files);
    }
  });
}

// Manejar archivos arrastrados al proyecto
async function handleProjectFileDrop(files) {
  if (!projectDetailViewId) return;

  const project = projectsState.projects[projectDetailViewId];
  if (!project) return;

  if (!project.files) {
    project.files = [];
  }

  for (const file of files) {
    try {
      const content = await readFileContent(file);

      project.files.push({
        id: generateId(),
        name: file.name,
        type: file.type,
        size: file.size,
        content: content,
        createdAt: Date.now()
      });
    } catch (error) {
      console.error('Error al leer archivo:', error);
    }
  }

  // Guardar y actualizar UI
  saveProjects();
  renderProjectDetailFiles(project);
}


function toggleProjectsPanel() {
  const projectsPanel = document.getElementById('projects-panel');
  const emptyState = document.getElementById('empty-state');
  const chatState = document.getElementById('chat-state');
  const newsPanel = document.getElementById('news-panel');
  const travelPanel = document.getElementById('travel-panel');

  // Botones que deben ocultarse en el panel de proyectos
  const incognitoButtonEmpty = document.getElementById('incognito-toggle-empty');
  const screenOverlayToggleEmpty = document.getElementById('screen-overlay-toggle-empty');

  if (!projectsPanel) return;

  projectsPanelVisible = !projectsPanelVisible;

  if (projectsPanelVisible) {
    // Ocultar otros paneles
    if (emptyState) emptyState.style.display = 'none';
    if (chatState) chatState.style.display = 'none';
    if (newsPanel) newsPanel.style.display = 'none';
    if (travelPanel) travelPanel.style.display = 'none';

    // Ocultar botones del empty-state
    if (incognitoButtonEmpty) incognitoButtonEmpty.style.display = 'none';
    if (screenOverlayToggleEmpty) screenOverlayToggleEmpty.style.display = 'none';

    // Mostrar panel de proyectos
    projectsPanel.style.display = 'flex';

    // Renderizar proyectos
    renderProjectsPanelGrid();

    // Actualizar botón activo
    updateQuickActionButtons('projects-panel-btn');
  } else {
    // Ocultar panel de proyectos
    projectsPanel.style.display = 'none';

    // Mostrar el chat o empty state
    if (state.activeId && state.conversations[state.activeId]) {
      if (chatState) chatState.style.display = 'flex';
      renderActiveConversation();
    } else {
      if (emptyState) emptyState.style.display = 'flex';
      // Mostrar botones del empty-state
      if (incognitoButtonEmpty) incognitoButtonEmpty.style.display = 'flex';
      if (screenOverlayToggleEmpty) screenOverlayToggleEmpty.style.display = 'flex';
    }

    // Quitar estado activo del botón
    const btn = document.getElementById('projects-panel-btn');
    if (btn) btn.classList.remove('active');
  }
}

function updateQuickActionButtons(activeId) {
  // Quitar estado activo de todos los botones de acciones rápidas
  const buttons = document.querySelectorAll('.quick-action-btn');
  buttons.forEach(btn => btn.classList.remove('active'));

  // Añadir estado activo al botón seleccionado
  if (activeId) {
    const activeBtn = document.getElementById(activeId);
    if (activeBtn) activeBtn.classList.add('active');
  }
}

function renderProjectsPanelGrid() {
  const grid = document.getElementById('projects-grid');
  if (!grid) return;

  let projects = Object.values(projectsState.projects);

  // Filtrar por búsqueda
  if (projectsSearchTerm) {
    projects = projects.filter(p =>
      p.name.toLowerCase().includes(projectsSearchTerm) ||
      (p.instructions && p.instructions.toLowerCase().includes(projectsSearchTerm))
    );
  }

  // Ordenar
  switch (projectsSortBy) {
    case 'name':
      projects.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case 'created':
      projects.sort((a, b) => b.createdAt - a.createdAt);
      break;
    case 'activity':
    default:
      projects.sort((a, b) => b.updatedAt - a.updatedAt);
      break;
  }

  if (projects.length === 0) {
    grid.innerHTML = `
      <div class="projects-empty-state">
        <div class="projects-empty-icon">📁</div>
        <p class="projects-empty-title">No hay proyectos</p>
        <p class="projects-empty-text">Crea un proyecto para organizar tus conversaciones y archivos</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = projects.map(project => {
    const updatedAgo = getTimeAgo(project.updatedAt);
    return `
      <div class="project-card" data-project-id="${project.id}">
        <h3 class="project-card-name">${escapeHtml(project.name)}</h3>
        <p class="project-card-meta">Actualizado ${updatedAgo}</p>
      </div>
    `;
  }).join('');

  // Añadir event listeners
  grid.querySelectorAll('.project-card').forEach(card => {
    card.addEventListener('click', () => {
      const projectId = card.dataset.projectId;
      openProjectDetailView(projectId);
    });
  });
}

function getTimeAgo(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (days > 0) {
    return `hace ${days} día${days > 1 ? 's' : ''}`;
  }
  if (hours > 0) {
    return `hace ${hours} hora${hours > 1 ? 's' : ''}`;
  }
  if (minutes > 0) {
    return `hace ${minutes} minuto${minutes > 1 ? 's' : ''}`;
  }
  return 'ahora mismo';
}

function openProjectDetailView(projectId) {
  const project = projectsState.projects[projectId];
  if (!project) return;

  projectDetailViewId = projectId;

  // Asegurar que los otros paneles estén ocultos
  const emptyState = document.getElementById('empty-state');
  const chatState = document.getElementById('chat-state');
  const newsPanel = document.getElementById('news-panel');
  const incognitoButtonEmpty = document.getElementById('incognito-toggle-empty');
  const screenOverlayToggleEmpty = document.getElementById('screen-overlay-toggle-empty');

  if (emptyState) emptyState.style.display = 'none';
  if (chatState) chatState.style.display = 'none';
  if (newsPanel) newsPanel.style.display = 'none';
  if (incognitoButtonEmpty) incognitoButtonEmpty.style.display = 'none';
  if (screenOverlayToggleEmpty) screenOverlayToggleEmpty.style.display = 'none';

  const listView = document.getElementById('projects-list-view');
  const detailView = document.getElementById('project-detail-view');

  if (listView) listView.style.display = 'none';
  if (detailView) detailView.style.display = 'flex';

  // Actualizar nombre
  const nameEl = document.getElementById('project-detail-name');
  if (nameEl) nameEl.textContent = project.name;

  // Actualizar instrucciones
  const instructionsHint = document.getElementById('project-instructions-hint');
  const instructionsContent = document.getElementById('project-instructions-content');

  if (project.instructions && project.instructions.trim()) {
    if (instructionsHint) instructionsHint.style.display = 'none';
    if (instructionsContent) {
      instructionsContent.style.display = 'block';
      instructionsContent.textContent = project.instructions;
    }
  } else {
    if (instructionsHint) instructionsHint.style.display = 'block';
    if (instructionsContent) instructionsContent.style.display = 'none';
  }

  // Renderizar archivos
  renderProjectDetailFiles(project);

  // Renderizar conversaciones
  renderProjectDetailConversations(project);

  // Establecer el proyecto activo SIN crear conversación ni mostrar otros paneles
  projectsState.activeProjectId = projectId;
  saveActiveProject(projectId);
  updateProjectBadge();
  renderProjectsList();

  // Inicializar drag & drop para archivos (después de que el sidebar esté visible)
  initProjectFilesDragDrop();

  // Llenar el selector de modelos del proyecto
  populateProjectModelSelect();

  // Inicializar el toggle de modos
  initProjectChatModeToggle();
}



function closeProjectDetailView() {
  projectDetailViewId = null;

  const listView = document.getElementById('projects-list-view');
  const detailView = document.getElementById('project-detail-view');

  if (listView) listView.style.display = 'flex';
  if (detailView) detailView.style.display = 'none';

  // Desactivar proyecto
  setActiveProject(null);
}

function renderProjectDetailFiles(project) {
  const container = document.getElementById('project-detail-files');
  if (!container) return;

  // Limpiar estado de selección
  window.projectSelectedFiles = window.projectSelectedFiles || new Set();

  if (!project.files || project.files.length === 0) {
    container.innerHTML = '<div class="project-no-files">Arrastra archivos aquí o haz clic en + para añadir</div>';
    updateProjectFilesActionBar(project);
    return;
  }

  container.innerHTML = project.files.map(file => {
    const ext = getFileExtension(file.name).toUpperCase();
    const lines = file.content ? Math.ceil(file.content.length / 80) : 0;
    const isSelected = window.projectSelectedFiles.has(file.id);

    return `
      <div class="project-file-card${isSelected ? ' selected' : ''}" data-file-id="${file.id}">
        <div class="project-file-checkbox">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </div>
        <div class="project-file-content">
          <p class="project-file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</p>
          <p class="project-file-meta">${lines} líneas</p>
        </div>
        <div class="project-file-footer">
          <span class="project-file-type">${ext}</span>
        </div>
      </div>
    `;
  }).join('');

  // Añadir event listeners para selección de archivos (solo en el checkbox)
  container.querySelectorAll('.project-file-card').forEach(card => {
    const checkbox = card.querySelector('.project-file-checkbox');
    const fileId = card.dataset.fileId;

    checkbox.addEventListener('click', (e) => {
      e.stopPropagation();
      card.classList.toggle('selected');

      if (card.classList.contains('selected')) {
        window.projectSelectedFiles.add(fileId);
      } else {
        window.projectSelectedFiles.delete(fileId);
      }

      updateProjectFilesActionBar(project);
    });
  });

  updateProjectFilesActionBar(project);
}

// Actualizar barra de acciones de archivos
function updateProjectFilesActionBar(project) {
  const filesSection = document.querySelector('.project-files-section');
  if (!filesSection) return;

  // Buscar o crear la barra de acciones
  let actionBar = filesSection.querySelector('.project-files-action-bar');
  const selectedCount = window.projectSelectedFiles?.size || 0;

  if (selectedCount === 0) {
    // Ocultar barra de acciones si existe
    if (actionBar) {
      actionBar.remove();
    }
    return;
  }

  // Crear barra de acciones si no existe
  if (!actionBar) {
    actionBar = document.createElement('div');
    actionBar.className = 'project-files-action-bar';
    const header = filesSection.querySelector('.project-section-header');
    if (header) {
      header.after(actionBar);
    }
  }

  actionBar.innerHTML = `
    <div class="project-files-selection-info">
      <div class="project-files-selection-checkbox">
        <div style="width: 10px; height: 3px; background: white; border-radius: 1px;"></div>
      </div>
      <span>${selectedCount} seleccionado${selectedCount !== 1 ? 's' : ''}</span>
    </div>
    <button class="project-files-delete-btn" title="Eliminar seleccionados">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="3 6 5 6 21 6"></polyline>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
      </svg>
    </button>
    <button class="project-files-close-btn" title="Cancelar selección">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    </button>
  `;

  // Event listener para eliminar
  actionBar.querySelector('.project-files-delete-btn').addEventListener('click', () => {
    deleteSelectedProjectFiles(project);
  });

  // Event listener para cancelar selección
  actionBar.querySelector('.project-files-close-btn').addEventListener('click', () => {
    window.projectSelectedFiles.clear();
    renderProjectDetailFiles(project);
  });
}

// Eliminar archivos seleccionados
function deleteSelectedProjectFiles(project) {
  if (!window.projectSelectedFiles || window.projectSelectedFiles.size === 0) return;

  const count = window.projectSelectedFiles.size;
  if (!confirm(`¿Eliminar ${count} archivo${count !== 1 ? 's' : ''} del proyecto?`)) return;

  // Filtrar archivos que no están seleccionados
  project.files = project.files.filter(file => !window.projectSelectedFiles.has(file.id));

  // Limpiar selección
  window.projectSelectedFiles.clear();

  // Guardar y renderizar
  saveProjects();
  renderProjectDetailFiles(project);
}


function renderProjectDetailConversations(project) {
  const container = document.getElementById('project-conversations-list');
  if (!container) return;

  const conversationIds = project.conversationIds || [];

  if (conversationIds.length === 0) {
    container.innerHTML = `
      <div class="project-no-conversations" style="text-align: center; padding: 40px; color: rgba(255,255,255,0.4);">
        <p>No hay conversaciones en este proyecto</p>
        <p style="font-size: 13px; margin-top: 8px;">Escribe un mensaje para comenzar</p>
      </div>
    `;
    return;
  }

  // Obtener las conversaciones y ordenarlas por fecha
  const conversations = conversationIds
    .map(id => state.conversations[id])
    .filter(conv => conv)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  container.innerHTML = conversations.map(conv => {
    const lastMessage = conv.messages[conv.messages.length - 1];
    const preview = lastMessage
      ? lastMessage.content.substring(0, 80) + (lastMessage.content.length > 80 ? '...' : '')
      : 'Sin mensajes';
    const timeAgo = getTimeAgo(conv.updatedAt);

    return `
      <div class="project-conversation-item" data-conv-id="${conv.id}">
        <p class="project-conversation-title">${escapeHtml(conv.title || 'Nueva conversación')}</p>
        <p class="project-conversation-meta">Último mensaje ${timeAgo}</p>
      </div>
    `;
  }).join('');

  // Añadir event listeners
  container.querySelectorAll('.project-conversation-item').forEach(item => {
    item.addEventListener('click', () => {
      const convId = item.dataset.convId;
      // Cerrar el panel de proyectos y abrir la conversación
      toggleProjectsPanel();
      setActiveConversation(convId);
    });
  });
}

function populateProjectModelSelect() {
  const select = document.getElementById('project-model-select');
  if (!select) return;

  // Copiar opciones del selector principal
  const mainSelect = document.getElementById('model-select');
  if (mainSelect && mainSelect.options.length > 0) {
    select.innerHTML = mainSelect.innerHTML;
    select.value = mainSelect.value || state.currentModel;
  } else {
    // Si el selector principal no tiene opciones, cargar directamente
    if (state.models && state.models.length > 0) {
      select.innerHTML = state.models.map(model =>
        `<option value="${model.name}" ${model.name === state.currentModel ? 'selected' : ''}>${model.name}</option>`
      ).join('');
    } else {
      select.innerHTML = '<option value="">Cargando modelos...</option>';
    }
  }

  // Sincronizar cambios
  select.addEventListener('change', () => {
    const mainSelect = document.getElementById('model-select');
    if (mainSelect) mainSelect.value = select.value;
    state.currentModel = select.value;
  });
}

async function sendProjectMessage() {
  const input = document.getElementById('project-prompt-input');
  if (!input || !input.value.trim()) return;

  const message = input.value.trim();
  input.value = '';
  input.style.height = 'auto';

  // Asegurar que hay un proyecto activo
  if (!projectDetailViewId) return;

  const project = projectsState.projects[projectDetailViewId];
  if (!project) return;

  // SIEMPRE crear una nueva conversación para el proyecto
  const newConv = createProjectConversation(projectDetailViewId);
  if (!newConv) return;

  // Cerrar el panel de proyectos inmediatamente
  const projectsPanel = document.getElementById('projects-panel');
  const chatState = document.getElementById('chat-state');

  if (projectsPanel) {
    projectsPanel.style.display = 'none';
  }
  projectsPanelVisible = false;

  // Mostrar el chat
  if (chatState) {
    chatState.style.display = 'flex';
  }

  // Quitar estado activo del botón
  const btn = document.getElementById('projects-panel-btn');
  if (btn) btn.classList.remove('active');

  // Poner el mensaje en el input principal y enviarlo
  const promptInputInline = document.getElementById('prompt-input-inline');
  if (promptInputInline) {
    promptInputInline.value = message;
    promptInputInline.focus();

    // Enviar el mensaje
    const form = document.getElementById('chat-form-inline');
    if (form) {
      form.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  } else if (promptInput) {
    promptInput.value = message;
    promptInput.focus();

    const form = document.getElementById('chat-form');
    if (form) {
      form.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  }
}

// ========================================
// Sistema de Información de Contexto del Modelo
// ========================================

// Cache de información de modelos
const modelContextCache = {};
const MODEL_CONTEXT_DEFAULTS = {
  // Contextos conocidos por defecto (en tokens)
  'llama2': 4096,
  'llama3': 8192,
  'llama3.1': 131072,
  'llama3.2': 131072,
  'mistral': 32768,
  'mixtral': 32768,
  'ministral': 262144, // 256K
  'devstral': 131072,  // 128K
  'codellama': 16384,
  'deepseek-coder': 16384,
  'deepseek-r1': 65536,
  'qwen': 32768,
  'qwen2': 131072,
  'qwen2.5': 131072,
  'qwen3': 131072,
  'phi': 2048,
  'phi3': 131072,
  'gemma': 8192,
  'gemma2': 8192,
  'llava': 4096,
  'gpt-oss': 32768,
  'mathstral': 32768,
  'default': 4096
};

// Estimar tokens de un texto (aproximación: ~4 caracteres por token para español/inglés)
function estimateTokens(text) {
  if (!text) return 0;
  // Estimación más precisa: ~3.5 caracteres por token en español
  return Math.ceil(text.length / 3.5);
}

// Formatear número de tokens para mostrar
function formatTokens(tokens) {
  if (tokens >= 1000000) {
    return (tokens / 1000000).toFixed(1) + 'M';
  }
  if (tokens >= 1000) {
    return (tokens / 1000).toFixed(1) + 'K';
  }
  return tokens.toString();
}

// Obtener información de contexto de un modelo usando la API de Ollama
async function getModelContextInfo(modelName) {
  if (!modelName) return null;

  // Revisar cache primero
  if (modelContextCache[modelName]) {
    return modelContextCache[modelName];
  }

  try {
    const response = await fetch(`${API_BASE}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName })
    });

    if (!response.ok) {
      throw new Error('No se pudo obtener información del modelo');
    }

    const data = await response.json();

    // Extraer num_ctx de los parámetros del modelo
    let contextLength = MODEL_CONTEXT_DEFAULTS.default;

    // Buscar en los parámetros del modelfile
    if (data.parameters) {
      const ctxMatch = data.parameters.match(/num_ctx\s+(\d+)/i);
      if (ctxMatch) {
        contextLength = parseInt(ctxMatch[1]);
      }
    }

    // Si no se encontró, usar valores por defecto basados en el nombre del modelo
    if (contextLength === MODEL_CONTEXT_DEFAULTS.default) {
      const baseName = modelName.split(':')[0].toLowerCase();
      for (const [key, value] of Object.entries(MODEL_CONTEXT_DEFAULTS)) {
        if (baseName.includes(key)) {
          contextLength = value;
          break;
        }
      }
    }

    // Extraer información adicional del modelo
    const info = {
      name: modelName,
      contextLength: contextLength,
      family: data.details?.family || 'unknown',
      parameterSize: data.details?.parameter_size || 'unknown',
      quantization: data.details?.quantization_level || 'unknown',
      template: data.template || '',
      modelfile: data.modelfile || ''
    };

    // Guardar en cache
    modelContextCache[modelName] = info;

    return info;
  } catch (error) {
    console.warn('Error al obtener información del modelo:', error);

    // Devolver información por defecto
    const baseName = modelName.split(':')[0].toLowerCase();
    let defaultContext = MODEL_CONTEXT_DEFAULTS.default;

    for (const [key, value] of Object.entries(MODEL_CONTEXT_DEFAULTS)) {
      if (baseName.includes(key)) {
        defaultContext = value;
        break;
      }
    }

    return {
      name: modelName,
      contextLength: defaultContext,
      family: 'unknown',
      parameterSize: 'unknown',
      quantization: 'unknown',
      template: '',
      modelfile: ''
    };
  }
}

// Calcular tokens usados por el proyecto
function calculateProjectTokens(instructionsText, files) {
  let instructionsTokens = 0;
  let documentsTokens = 0;

  // Tokens de instrucciones
  if (instructionsText) {
    // Incluir el formato del contexto
    const formattedInstructions = `══════════════════════════════════════════════════════════════\n📋 INSTRUCCIONES DEL PROYECTO: "Proyecto"\n══════════════════════════════════════════════════════════════\n\n${instructionsText}\n\n`;
    instructionsTokens = estimateTokens(formattedInstructions);
  }

  // Tokens de documentos (solo archivos de texto, no imágenes)
  const textFiles = (files || []).filter(f => !f.isImage);
  if (textFiles.length > 0) {
    let documentContext = '=== DOCUMENTOS DEL PROYECTO (DEBES LEER Y USAR ESTE CONTENIDO) ===\n\n';

    textFiles.forEach((file, index) => {
      documentContext += `══════════════════════════════════════════════════════════════\n`;
      documentContext += `📄 DOCUMENTO ${index + 1}: ${file.name}\n`;
      documentContext += `══════════════════════════════════════════════════════════════\n\n`;
      documentContext += `${file.content || ''}\n\n`;
    });

    documentContext += '=== FIN DE DOCUMENTOS DEL PROYECTO ===\n\n';
    documentContext += 'IMPORTANTE: Debes seguir las instrucciones del proyecto y USAR el contenido de los documentos proporcionados para responder las preguntas del usuario. Si el usuario pregunta sobre los documentos, resume o explica lo que contienen.\n';

    documentsTokens = estimateTokens(documentContext);
  }

  return {
    instructions: instructionsTokens,
    documents: documentsTokens,
    total: instructionsTokens + documentsTokens
  };
}

// Obtener todos los modelos disponibles con su información de contexto
async function getAllModelsWithContext() {
  try {
    const response = await fetch(`${API_BASE}/api/tags`);
    if (!response.ok) throw new Error('Error al cargar modelos');

    const data = await response.json();
    const models = data?.models ?? [];

    // Obtener información de contexto para cada modelo
    const modelsWithContext = await Promise.all(
      models.map(async (model) => {
        const contextInfo = await getModelContextInfo(model.name);
        return {
          name: model.name,
          displayName: formatModelName(model.name),
          contextLength: contextInfo?.contextLength || MODEL_CONTEXT_DEFAULTS.default,
          size: model.size
        };
      })
    );

    // Ordenar por contexto de mayor a menor
    modelsWithContext.sort((a, b) => b.contextLength - a.contextLength);

    return modelsWithContext;
  } catch (error) {
    console.warn('Error al obtener modelos:', error);
    return [];
  }
}

// Formatear nombre del modelo para mostrar
function formatModelName(modelName) {
  if (!modelName) return 'Desconocido';

  if (modelName.includes(':')) {
    const parts = modelName.split(':');
    const baseName = parts[0];
    const tag = parts[1] || '';

    const formattedBase = baseName.charAt(0).toUpperCase() + baseName.slice(1);

    if (tag.includes('-')) {
      const tagParts = tag.split('-');
      const size = tagParts[0];
      return `${formattedBase} ${size.toUpperCase()}`;
    }

    return `${formattedBase} ${tag.toUpperCase()}`;
  }

  return modelName.charAt(0).toUpperCase() + modelName.slice(1);
}

// Actualizar la UI de información de contexto
async function updateProjectContextInfo() {
  const modelNameEl = document.getElementById('context-model-name');
  const modelCapacityEl = document.getElementById('context-model-capacity');
  const usageBarFillEl = document.getElementById('context-usage-fill');
  const usageUsedEl = document.getElementById('context-usage-used');
  const usagePercentEl = document.getElementById('context-usage-percent');
  const breakdownInstructionsEl = document.getElementById('breakdown-instructions');
  const breakdownDocumentsEl = document.getElementById('breakdown-documents');
  const breakdownChatEl = document.getElementById('breakdown-chat');
  const warningEl = document.getElementById('context-warning');
  const warningTitleEl = document.getElementById('warning-title');
  const warningMessageEl = document.getElementById('warning-message');
  const suggestionEl = document.getElementById('context-suggestion');
  const suggestedModelsEl = document.getElementById('suggested-models');
  const refreshBtn = document.getElementById('context-refresh-btn');
  const contextInfoCard = document.getElementById('project-context-info');

  if (!modelNameEl || !contextInfoCard) return;

  // Añadir clase de loading
  refreshBtn?.classList.add('loading');
  contextInfoCard.classList.add('loading');

  try {
    // Obtener modelo actual
    const currentModel = state.currentModel;
    if (!currentModel) {
      modelNameEl.textContent = 'No hay modelo seleccionado';
      modelCapacityEl.textContent = 'Selecciona un modelo';
      return;
    }

    // Obtener información del modelo
    const modelInfo = await getModelContextInfo(currentModel);
    const contextLength = modelInfo?.contextLength || MODEL_CONTEXT_DEFAULTS.default;

    // Actualizar nombre y capacidad del modelo
    modelNameEl.textContent = formatModelName(currentModel);
    modelCapacityEl.textContent = `${formatTokens(contextLength)} tokens de contexto`;

    // Obtener contenido actual del proyecto
    const instructionsInput = document.getElementById('project-instructions-input');
    const instructions = instructionsInput?.value || '';
    const files = projectsState.tempProjectFiles || [];

    // Calcular tokens
    const tokenUsage = calculateProjectTokens(instructions, files);
    const chatReserve = 2000; // Reservar tokens para la conversación
    const totalUsed = tokenUsage.total;
    const totalWithReserve = totalUsed + chatReserve;
    const usagePercent = Math.min(100, Math.round((totalWithReserve / contextLength) * 100));

    // Actualizar barra de uso
    usageBarFillEl.style.width = `${usagePercent}%`;
    usageUsedEl.textContent = `${formatTokens(totalUsed)} tokens usados`;
    usagePercentEl.textContent = `${usagePercent}%`;

    // Cambiar color según el uso
    usageBarFillEl.classList.remove('warning', 'danger', 'critical');
    if (usagePercent >= 100) {
      usageBarFillEl.classList.add('critical');
    } else if (usagePercent >= 85) {
      usageBarFillEl.classList.add('danger');
    } else if (usagePercent >= 70) {
      usageBarFillEl.classList.add('warning');
    }

    // Actualizar desglose
    breakdownInstructionsEl.textContent = `${formatTokens(tokenUsage.instructions)} tokens`;
    breakdownDocumentsEl.textContent = `${formatTokens(tokenUsage.documents)} tokens`;
    breakdownChatEl.textContent = `~${formatTokens(chatReserve)} tokens`;

    // Mostrar/ocultar advertencia
    if (totalWithReserve > contextLength) {
      warningEl.style.display = 'flex';
      const excesoTokens = totalWithReserve - contextLength;
      warningTitleEl.textContent = '⚠️ Contexto excedido';
      warningMessageEl.textContent = `El contenido supera la capacidad del modelo por ${formatTokens(excesoTokens)} tokens. El modelo podría perder información o dar respuestas incompletas. Considera reducir el contenido o usar un modelo con más contexto.`;

      // Buscar modelos alternativos
      const allModels = await getAllModelsWithContext();
      const compatibleModels = allModels.filter(m => m.contextLength >= totalWithReserve && m.name !== currentModel);

      if (compatibleModels.length > 0) {
        suggestionEl.style.display = 'flex';
        suggestedModelsEl.innerHTML = compatibleModels.slice(0, 3).map(m => `
          <button class="suggested-model-btn" data-model="${escapeHtml(m.name)}">
            ${escapeHtml(m.displayName)}
            <span class="model-ctx">${formatTokens(m.contextLength)}</span>
          </button>
        `).join('');

        // Añadir event listeners para cambiar de modelo
        suggestedModelsEl.querySelectorAll('.suggested-model-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const newModel = btn.dataset.model;
            if (newModel) {
              switchToModel(newModel);
            }
          });
        });
      } else {
        suggestionEl.style.display = 'none';
      }
    } else if (usagePercent >= 85) {
      warningEl.style.display = 'flex';
      warningTitleEl.textContent = '⚠️ Uso elevado de contexto';
      warningMessageEl.textContent = `Estás usando el ${usagePercent}% del contexto disponible. Podrías tener poco espacio para conversaciones largas.`;
      suggestionEl.style.display = 'none';
    } else {
      warningEl.style.display = 'none';
      suggestionEl.style.display = 'none';
    }

  } catch (error) {
    console.error('Error al actualizar info de contexto:', error);
  } finally {
    refreshBtn?.classList.remove('loading');
    contextInfoCard.classList.remove('loading');
  }
}

// Cambiar al modelo sugerido
async function switchToModel(modelName) {
  state.currentModel = modelName;

  // Actualizar selectores de modelo
  const selects = [modelSelect, modelSelectInline].filter(Boolean);
  selects.forEach(select => {
    if (select) {
      select.value = modelName;
    }
  });

  persistState();

  // Actualizar info de contexto
  await updateProjectContextInfo();
}

// Inicializar sistema de información de contexto
function initProjectContextInfo() {
  // Botón de actualizar
  const refreshBtn = document.getElementById('context-refresh-btn');
  refreshBtn?.addEventListener('click', () => {
    updateProjectContextInfo();
  });

  // Escuchar cambios en las instrucciones
  const instructionsInput = document.getElementById('project-instructions-input');
  let debounceTimer = null;

  instructionsInput?.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      updateProjectContextInfo();
    }, 500);
  });

  // Escuchar cambios en el modelo
  [modelSelect, modelSelectInline].filter(Boolean).forEach(select => {
    select?.addEventListener('change', () => {
      updateProjectContextInfo();
    });
  });
}

// ========================================
// Sistema Deep Research
// ========================================
let deepResearchMode = false;
const MAX_RESEARCH_ITERATIONS = 5;
const MAX_FOLLOW_UP_QUESTIONS = 3;

// Control de cancelación para Deep Research
let deepResearchAbortController = null;
let deepResearchActiveConversationId = null;
let deepResearchStartTime = null;
let deepResearchStepTimes = []; // Para estimar tiempo
let deepResearchProgressState = null; // Estado del progreso para mostrar en UI
let deepResearchCurrentContainer = null; // Referencia al contenedor actual
let deepResearchMessageId = null; // ID del mensaje de respuesta
let deepResearchStepsData = []; // Datos de los pasos para restaurar
let deepResearchFindingsData = []; // Datos de los hallazgos para restaurar

// Función para verificar si Deep Research está en progreso
function isDeepResearchInProgress() {
  return deepResearchAbortController !== null && deepResearchActiveConversationId !== null;
}

// Obtener el indicador de investigación para una conversación
function getResearchIndicator(conversationId) {
  if (deepResearchActiveConversationId === conversationId && deepResearchProgressState) {
    return `<span class="research-indicator" title="Investigación en progreso: ${deepResearchProgressState.progress}%">
      <svg class="research-indicator-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5" opacity="0.12"></circle>
        <path class="research-indicator-spinner" d="M12 6a6 6 0 0 1 0 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
      </svg>
    </span>`;
  }
  return '';
}

// Función para cancelar Deep Research en progreso (solo manual)
function cancelDeepResearch() {
  if (deepResearchAbortController) {
    console.log('🛑 Cancelando Deep Research en progreso...');
    deepResearchAbortController.abort();
    deepResearchAbortController = null;
    deepResearchActiveConversationId = null;
    deepResearchStartTime = null;
    deepResearchStepTimes = [];

    // Desactivar modo si estaba activo
    if (deepResearchMode) {
      toggleDeepResearch();
    }

    // Restablecer estado de carga
    state.loading = false;

    // Desbloquear inputs
    unlockInputsDuringResearch();
  }
}

// Bloquear inputs mientras investiga
function lockInputsDuringResearch() {
  const inputs = document.querySelectorAll('#prompt-input, #prompt-input-inline');
  const sendButtons = document.querySelectorAll('.send-button');

  inputs.forEach(input => {
    if (input) {
      input.dataset.originalPlaceholder = input.placeholder;
      input.placeholder = 'Investigación en progreso... Solo lectura';
      input.disabled = true;
      input.classList.add('research-locked');
    }
  });

  sendButtons.forEach(btn => {
    if (btn) {
      // Guardar contenido original y convertir en botón de detener
      btn.dataset.originalContent = btn.innerHTML;
      btn.innerHTML = '<svg class="stop-research-spinner" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10" stroke-dasharray="31.4" stroke-dashoffset="10"></circle></svg>';
      btn.disabled = false;
      btn.classList.add('research-active-btn');
      btn.classList.remove('research-locked');
      btn.title = 'Detener investigación';
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        cancelDeepResearch();
      };
    }
  });

  // Ocultar temporalmente el activity chart y ranking si están visibles (para evitar superposición visual)
  const activityChart = document.getElementById('activity-chart');
  const modelsRanking = document.getElementById('models-ranking');
  [activityChart, modelsRanking].forEach(el => {
    if (el) {
      // Guardar display original
      el.dataset.__origDisplay = el.style.display || '';
      el.style.display = 'none';
    }
  });
  // Marca global de estado 'research-active' para ocultar automáticamente elementos si hay CSS que lo soporta
  document.body.classList.add('research-active');
}

// Desbloquear inputs después de investigar
function unlockInputsDuringResearch() {
  const inputs = document.querySelectorAll('#prompt-input, #prompt-input-inline');
  const sendButtons = document.querySelectorAll('.send-button');

  inputs.forEach(input => {
    if (input) {
      input.placeholder = input.dataset.originalPlaceholder || 'Escribe un mensaje...';
      input.disabled = false;
      input.classList.remove('research-locked');
    }
  });

  sendButtons.forEach(btn => {
    if (btn) {
      // Restaurar contenido original del botón
      btn.innerHTML = btn.dataset.originalContent || '↑';
      btn.disabled = false;
      btn.classList.remove('research-locked');
      btn.classList.remove('research-active-btn');
      btn.title = 'Enviar';
      btn.onclick = null;
    }
  });

  // Restaurar visibilidad del activity chart y ranking
  const activityChart = document.getElementById('activity-chart');
  const modelsRanking = document.getElementById('models-ranking');
  [activityChart, modelsRanking].forEach(el => {
    if (el) {
      el.style.display = el.dataset.__origDisplay || '';
      delete el.dataset.__origDisplay;
    }
  });
  // Restaurar clase global
  document.body.classList.remove('research-active');
}

function toggleDeepResearch(button) {
  deepResearchMode = !deepResearchMode;

  // Actualizar los toggles de modo de chat
  const toggles = document.querySelectorAll('.chat-mode-toggle');
  toggles.forEach(toggle => {
    if (deepResearchMode) {
      toggle.setAttribute('data-active-mode', 'deep');
      // Actualizar botones activos
      toggle.querySelectorAll('.chat-mode-option').forEach(opt => {
        opt.classList.toggle('active', opt.dataset.mode === 'deep');
      });
    } else {
      toggle.setAttribute('data-active-mode', 'normal');
      // Actualizar botones activos
      toggle.querySelectorAll('.chat-mode-option').forEach(opt => {
        opt.classList.toggle('active', opt.dataset.mode === 'normal');
      });
    }
  });

  console.log(`🔬 Deep Research: ${deepResearchMode ? 'activado' : 'desactivado'}`);

  console.log(`🧠 Deep Think: ${deepResearchMode ? 'activado' : 'desactivado'}`);
}

// Variable para modo estudio
let studyMode = false;

// Variable para modo web (búsqueda en internet)
let webSearchMode = false;

// Función para obtener la API key de Serper desde localStorage
function getSerperApiKey() {
  return localStorage.getItem('serper-api-key') || null;
}

// Crear HTML estático de búsqueda web para restaurar desde el estado guardado
function createWebSearchUIForRestore(webData) {
  if (!webData || !webData.results) return '';

  const sourcesHtml = webData.results.map((result, index) => {
    let domain = '';
    let faviconUrl = '';
    try {
      const urlObj = new URL(result.link);
      domain = urlObj.hostname;
      faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
    } catch (e) {
      domain = 'web';
    }

    return `
      <a class="web-search-source-item" href="${result.link}" target="_blank" rel="noopener noreferrer" style="animation: none; opacity: 1; transform: none;">
        <img class="web-search-source-icon" src="${faviconUrl}" alt="${domain}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
        <div class="web-search-source-icon-fallback" style="display:none;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
        </div>
        <div class="web-search-source-content">
          <div class="web-search-source-title">${escapeHtml(result.title)}</div>
          <div class="web-search-source-snippet">${escapeHtml(result.snippet || '')}</div>
          <div class="web-search-source-url">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
            ${domain}
          </div>
        </div>
      </a>
    `;
  }).join('');

  const finalSourcesHtml = webData.results.map(result => {
    let domain = '';
    try {
      domain = new URL(result.link).hostname.replace('www.', '');
    } catch (e) {
      domain = 'web';
    }
    return `
      <a href="${result.link}" target="_blank" rel="noopener noreferrer" class="web-search-final-source" title="${escapeHtml(result.title)}">
        <img class="web-search-final-source-favicon" src="https://www.google.com/s2/favicons?domain=${domain}&sz=32" alt="" onerror="this.style.display='none'">
        <span class="web-search-final-source-name">${domain}</span>
      </a>
    `;
  }).join('');

  return `
    <div class="web-search-container minimized">
      <div class="web-search-header" style="cursor: pointer;" onclick="this.parentElement.classList.toggle('minimized');">
        <div class="web-search-title">
          <svg class="web-search-icon done" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
            <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" stroke="currentColor" stroke-width="2"/>
          </svg>
          Búsqueda web
        </div>
        <div class="web-search-header-right">
          <div class="web-search-status">
            <span class="web-search-status-dot done"></span>
            <span class="web-search-status-text">Completado</span>
          </div>
          <button class="web-search-toggle-btn" title="Expandir" onclick="event.stopPropagation(); this.closest('.web-search-container').classList.toggle('minimized'); this.title = this.closest('.web-search-container').classList.contains('minimized') ? 'Expandir' : 'Minimizar';">
            <svg class="web-search-toggle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="18 15 12 9 6 15"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="web-search-content">
        <div class="web-search-query">${escapeHtml(webData.query)}</div>
        <div class="web-search-progress">
          <div class="web-search-progress-text">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/>
              <path d="M21 21l-4.35-4.35"/>
            </svg>
            <span class="web-search-progress-label">Fuentes encontradas</span>
          </div>
        </div>
        <div class="web-search-sources-label">Fuentes consultadas</div>
        <div class="web-search-sources">${sourcesHtml}</div>
        <div class="web-search-final-sources">
          <div class="web-search-final-sources-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
              <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
            ${webData.results.length} fuentes consultadas
          </div>
          <div class="web-search-final-sources-list">${finalSourcesHtml}</div>
        </div>
      </div>
    </div>
  `;
}

// Crear elemento de UI para búsqueda web
function createWebSearchUI(query) {
  const container = document.createElement('div');
  container.className = 'web-search-container';
  container.innerHTML = `
    <div class="web-search-header">
      <div class="web-search-title">
        <svg class="web-search-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
          <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" stroke="currentColor" stroke-width="2"/>
        </svg>
        Buscando en la web
      </div>
      <div class="web-search-header-right">
        <div class="web-search-status">
          <span class="web-search-status-dot"></span>
          <span class="web-search-status-text">Trabajando...</span>
        </div>
        <button class="web-search-toggle-btn" title="Minimizar" style="display: none;">
          <svg class="web-search-toggle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="18 15 12 9 6 15"/>
          </svg>
        </button>
      </div>
    </div>
    <div class="web-search-content">
      <div class="web-search-query">${escapeHtml(query)}</div>
      <div class="web-search-progress">
        <div class="web-search-progress-text">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/>
            <path d="M21 21l-4.35-4.35"/>
          </svg>
          <span class="web-search-progress-label">Buscando resultados relevantes...</span>
        </div>
      </div>
      <div class="web-search-sources-label">Revisando fuentes</div>
      <div class="web-search-sources">
        ${createSkeletonSources(3)}
      </div>
    </div>
  `;
  return container;
}

// Crear fuentes skeleton (placeholders)
function createSkeletonSources(count) {
  let html = '';
  for (let i = 0; i < count; i++) {
    html += `
      <div class="web-search-source-skeleton">
        <div class="skeleton-icon"></div>
        <div class="skeleton-content">
          <div class="skeleton-title"></div>
          <div class="skeleton-text"></div>
        </div>
      </div>
    `;
  }
  return html;
}

// Actualizar UI con resultados de búsqueda
function updateWebSearchUI(container, searchData, query) {
  if (!container || !searchData) return;

  // Actualizar estado a completado
  const statusDot = container.querySelector('.web-search-status-dot');
  const statusText = container.querySelector('.web-search-status-text');
  const searchIcon = container.querySelector('.web-search-icon');
  const progressLabel = container.querySelector('.web-search-progress-label');
  const toggleBtn = container.querySelector('.web-search-toggle-btn');
  const content = container.querySelector('.web-search-content');

  if (statusDot) statusDot.classList.add('done');
  if (statusText) statusText.textContent = 'Completado';
  if (searchIcon) searchIcon.classList.add('done');
  if (progressLabel) progressLabel.textContent = 'Fuentes encontradas';

  // Mostrar botón de minimizar
  if (toggleBtn) {
    toggleBtn.style.display = 'flex';
    toggleBtn.onclick = (e) => {
      e.stopPropagation();
      container.classList.toggle('minimized');
      toggleBtn.title = container.classList.contains('minimized') ? 'Expandir' : 'Minimizar';
    };
  }

  // Permitir hacer clic en el header para expandir/minimizar
  const header = container.querySelector('.web-search-header');
  if (header) {
    header.style.cursor = 'pointer';
    header.onclick = () => {
      if (toggleBtn && toggleBtn.style.display !== 'none') {
        container.classList.toggle('minimized');
        toggleBtn.title = container.classList.contains('minimized') ? 'Expandir' : 'Minimizar';
      }
    };
  }

  // Actualizar fuentes
  const sourcesContainer = container.querySelector('.web-search-sources');
  if (sourcesContainer && searchData.organic) {
    sourcesContainer.innerHTML = '';

    searchData.organic.slice(0, 5).forEach((result, index) => {
      const sourceItem = document.createElement('a');
      sourceItem.className = 'web-search-source-item';
      sourceItem.href = result.link;
      sourceItem.target = '_blank';
      sourceItem.rel = 'noopener noreferrer';
      sourceItem.style.animationDelay = `${index * 0.1}s`;

      // Extraer dominio para el favicon
      let domain = '';
      let faviconUrl = '';
      try {
        const urlObj = new URL(result.link);
        domain = urlObj.hostname;
        // Usar el servicio de Google para obtener favicons
        faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
      } catch (e) {
        domain = 'web';
        faviconUrl = '';
      }

      sourceItem.innerHTML = `
        <img class="web-search-source-icon" src="${faviconUrl}" alt="${domain}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
        <div class="web-search-source-icon-fallback" style="display:none;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
        </div>
        <div class="web-search-source-content">
          <div class="web-search-source-title">${escapeHtml(result.title)}</div>
          <div class="web-search-source-snippet">${escapeHtml(result.snippet || '')}</div>
          <div class="web-search-source-url">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
            ${domain}
          </div>
        </div>
      `;

      sourcesContainer.appendChild(sourceItem);
    });
  }

  // Añadir sección de fuentes finales
  addFinalSources(container, searchData);
}

// Añadir las fuentes usadas al final
function addFinalSources(container, searchData) {
  if (!container || !searchData || !searchData.organic) return;

  const finalSourcesDiv = document.createElement('div');
  finalSourcesDiv.className = 'web-search-final-sources';

  const sourcesCount = Math.min(searchData.organic.length, 5);

  finalSourcesDiv.innerHTML = `
    <div class="web-search-final-sources-title">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
        <polyline points="22 4 12 14.01 9 11.01"/>
      </svg>
      ${sourcesCount} fuentes consultadas
    </div>
    <div class="web-search-final-sources-list">
      ${searchData.organic.slice(0, 5).map(result => {
    let domain = '';
    try {
      domain = new URL(result.link).hostname.replace('www.', '');
    } catch (e) {
      domain = 'web';
    }
    return `
          <a href="${result.link}" target="_blank" rel="noopener noreferrer" class="web-search-final-source" title="${escapeHtml(result.title)}">
            <img class="web-search-final-source-favicon" src="https://www.google.com/s2/favicons?domain=${domain}&sz=32" alt="" onerror="this.style.display='none'">
            <span class="web-search-final-source-name">${domain}</span>
          </a>
        `;
  }).join('')}
    </div>
  `;

  // Añadir al contenedor de contenido si existe, sino al container principal
  const contentContainer = container.querySelector('.web-search-content');
  if (contentContainer) {
    contentContainer.appendChild(finalSourcesDiv);
  } else {
    container.appendChild(finalSourcesDiv);
  }
}

// Función para buscar en la web con Serper API
async function searchWeb(query) {
  try {
    const apiKey = getSerperApiKey();
    if (!apiKey) {
      console.warn('⚠️ No hay API key de Serper configurada. Ve a Configuración > API Keys para añadirla.');
      return null;
    }

    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        q: query,
        gl: "es",
        hl: "es",
        num: 5
      })
    });

    if (!response.ok) {
      throw new Error(`Error en búsqueda: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error buscando en la web:', error);
    return null;
  }
}

// Función para buscar papers académicos en OpenAlex
async function searchAcademicPapers(query) {
  try {
    console.log('🔬 Buscando papers académicos:', query);
    
    const response = await fetch("https://api.openalex.org/works", {
      method: "GET",
      headers: {
        "User-Agent": "mailto:ollama-web@localhost.com"
      },
      params: new URLSearchParams({
        search: query,
        filter: "open_access.is_oa:true", // Solo open access
        per_page: 5,
        sort: "cited_by_count:desc" // Ordenar por citas
      })
    });

    // Construir URL manualmente porque fetch no soporta params directamente
    const url = new URL("https://api.openalex.org/works");
    url.searchParams.append("search", query);
    url.searchParams.append("filter", "open_access.is_oa:true");
    url.searchParams.append("per_page", "5");
    url.searchParams.append("sort", "cited_by_count:desc");

    const responseActual = await fetch(url.toString(), {
      headers: {
        "User-Agent": "mailto:ollama-web@localhost.com"
      }
    });

    if (!responseActual.ok) {
      throw new Error(`Error en búsqueda académica: ${responseActual.status}`);
    }

    const data = await responseActual.json();
    
    // Transformar a formato compatible con el resto del sistema
    const formattedData = {
      academic: true,
      results: data.results?.map(paper => ({
        title: paper.title || 'Sin título',
        link: paper.primary_location?.landing_page_url || paper.doi || `https://openalex.org/${paper.id}`,
        snippet: paper.abstract_inverted_index ? 
          reconstructAbstract(paper.abstract_inverted_index).substring(0, 300) + '...' :
          (paper.display_name || 'Abstract no disponible'),
        authors: paper.authorships?.slice(0, 3).map(a => a.author?.display_name).filter(Boolean).join(', '),
        year: paper.publication_year,
        citations: paper.cited_by_count,
        venue: paper.primary_location?.source?.display_name,
        doi: paper.doi
      })) || []
    };

    return formattedData;
  } catch (error) {
    console.error('Error buscando papers académicos:', error);
    return null;
  }
}

// Función auxiliar para reconstruir abstract desde inverted index
function reconstructAbstract(invertedIndex) {
  if (!invertedIndex) return '';
  
  const words = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    positions.forEach(pos => {
      words[pos] = word;
    });
  }
  
  return words.filter(Boolean).join(' ').substring(0, 500);
}

// Formatear resultados de búsqueda para el contexto del modelo
function formatSearchResults(searchData) {
  if (!searchData) return '';

  // Crear mapa de fuentes para citación
  window._webSourcesMap = [];

  // Si son resultados académicos
  if (searchData.academic && searchData.results) {
    let context = '📚 **PAPERS ACADÉMICOS ENCONTRADOS:**\n\n';
    
    searchData.results.forEach((paper, i) => {
      const sourceId = i + 1;
      window._webSourcesMap.push({
        id: sourceId,
        url: paper.link,
        title: paper.title,
        snippet: paper.snippet
      });
      
      context += `[${sourceId}] **${paper.title}**\n`;
      if (paper.authors) context += `    Autores: ${paper.authors}\n`;
      if (paper.year) context += `    Año: ${paper.year}\n`;
      if (paper.venue) context += `    Publicado en: ${paper.venue}\n`;
      if (paper.citations) context += `    Citado ${paper.citations} veces\n`;
      context += `    Abstract: ${paper.snippet}\n`;
      if (paper.doi) context += `    DOI: ${paper.doi}\n`;
      context += `\n`;
    });
    
    return context;
  }

  // Si son resultados web normales
  let context = '🌐 **FUENTES DE INFORMACIÓN WEB:**\n\n';

  // Answer box si existe
  if (searchData.answerBox) {
    context += `📌 **Respuesta destacada:**\n`;
    if (searchData.answerBox.title) context += `**${searchData.answerBox.title}**\n`;
    if (searchData.answerBox.answer) context += `${searchData.answerBox.answer}\n`;
    if (searchData.answerBox.snippet) context += `${searchData.answerBox.snippet}\n`;
    context += '\n';
  }

  // Knowledge graph si existe
  if (searchData.knowledgeGraph) {
    const kg = searchData.knowledgeGraph;
    context += `📚 **Información de Knowledge Graph:**\n`;
    if (kg.title) context += `**${kg.title}**`;
    if (kg.type) context += ` (${kg.type})`;
    context += '\n';
    if (kg.description) context += `${kg.description}\n`;
    context += '\n';
  }

  // Resultados orgánicos - FORMATO MEJORADO CON IDs
  if (searchData.organic && searchData.organic.length > 0) {
    context += `📋 **FUENTES DISPONIBLES (Usa [1], [2], etc. para citar):**\n\n`;
    searchData.organic.slice(0, 5).forEach((result, i) => {
      const sourceId = i + 1;
      window._webSourcesMap.push({
        id: sourceId,
        url: result.link,
        title: result.title,
        snippet: result.snippet
      });
      
      context += `[${sourceId}] **${result.title}**\n`;
      context += `    Fuente: ${new URL(result.link).hostname}\n`;
      context += `    Contenido: ${result.snippet}\n\n`;
    });
  }

  // People also ask
  if (searchData.peopleAlsoAsk && searchData.peopleAlsoAsk.length > 0) {
    context += `❓ **Preguntas relacionadas:**\n`;
    searchData.peopleAlsoAsk.slice(0, 3).forEach(q => {
      context += `- ${q.question}\n`;
      if (q.snippet) context += `  ${q.snippet}\n`;
    });
    context += '\n';
  }

  return context;
}

// Función para cambiar el modo de chat
function setChatMode(mode) {
  state.chatMode = mode;
  // Actualizar estados globales
  deepResearchMode = mode === 'deep';
  studyMode = mode === 'study';

  webSearchMode = mode === 'web';
  canvasMode = mode === 'canvas';
  window._canvasModeActive = canvasMode;

  // Modo música
  musicMode = mode === 'music';
  window._musicModeActive = musicMode;

  // Modo viajes
  travelModeActive = mode === 'travel';
  window._travelModeActive = travelModeActive;

  // Modo salud
  window._healthModeActive = mode === 'health';
  if (window.healthMode) window.healthMode.setActive(mode === 'health');

  // Mostrar/ocultar toggle de tipo de búsqueda según modo web
  const searchTypeToggle = document.querySelector('.web-search-type-toggle');
  if (searchTypeToggle) {
    const newDisplay = mode === 'web' ? 'flex' : 'none';
    searchTypeToggle.style.display = newDisplay;
    console.log(`🔍 Toggle de búsqueda: ${newDisplay} (modo: ${mode})`);
  } else {
    console.warn('⚠️ No se encontró el elemento .web-search-type-toggle');
  }

  // Asegurar que el modo activo esté en la lista de modos visibles
  const visibleModes = getVisibleChatModes();
  if (!visibleModes.includes(mode)) {
    visibleModes.push(mode);
    saveVisibleChatModes(visibleModes);
  }

  // Actualizar todos los toggles
  const toggles = document.querySelectorAll('.chat-mode-toggle');

  toggles.forEach(toggle => {
    toggle.setAttribute('data-active-mode', mode);
    toggle.querySelectorAll('.chat-mode-option').forEach(opt => {
      opt.classList.toggle('active', opt.dataset.mode === mode);
      // Asegurar que el modo activo siempre sea visible
      if (opt.dataset.mode === mode) {
        opt.style.display = '';
      }
    });

    // Calcular posición del slider basado en modos visibles (incluyendo el activo)
    const visibleModesList = [];
    toggle.querySelectorAll('.chat-mode-option').forEach(opt => {
      const optMode = opt.dataset.mode;
      if (visibleModes.includes(optMode) || optMode === mode) {
        visibleModesList.push(optMode);
      }
    });
    updateSliderPosition(toggle, visibleModesList);
  });

  // Log para debugging
  const modeNames = {
    'normal': '💬 Normal',
    'deep': '🧠 Deep Think',
    'study': '📚 Modo Estudio',
    'web': '🌐 Búsqueda Web',
    'canvas': '📝 Canvas',
    'music': '🎵 Música',
    'travel': '🗺️ Modo Viajes',
    'health': '🏥 Modo Salud'
  };
  console.log(`Modo de chat: ${modeNames[mode]}`);

  const conversation = state.conversations[state.activeId];
  if (canvasMode && conversation) {
    ensureCanvasDoc(conversation.id);
    renderCanvasPanel(conversation.id);
  } else {
    // Cuando no está en modo canvas, ocultar el panel
    toggleCanvasVisibility(false);
  }

  // Gestionar panel de música/partituras
  if (musicMode && conversation) {
    ensureScoreDoc(conversation.id);
    renderScoreCanvasPanel(conversation.id);
  } else {
    toggleScoreCanvasPanel(false);
  }

  // Gestionar modo viajes - el mapa ahora aparece inline en el chat, no en panel separado
  const travelPanel = document.getElementById('travel-panel');
  if (travelPanel) {
    // Siempre ocultar el panel de viajes antiguo, ahora los mapas van inline en el chat
    travelPanel.style.display = 'none';
  }

  if (travelModeActive) {
    // Solo inicializar la API Key de Mapbox, el chat permanece visible
    if (window.travelMode && typeof window.travelMode.init === 'function') {
      const mapboxApiKey = localStorage.getItem('mapbox-api-key');
      window.travelMode.init(mapboxApiKey);
    }
  }
}

function initDeepResearch() {
  // Inicializar los toggles de modo de chat
  const toggles = document.querySelectorAll('.chat-mode-toggle');

  toggles.forEach(toggle => {
    // Establecer modo inicial
    toggle.setAttribute('data-active-mode', 'normal');

    // Agregar eventos a cada opción
    toggle.querySelectorAll('.chat-mode-option').forEach(option => {
      option.addEventListener('click', (e) => {
        e.preventDefault();
        const mode = option.dataset.mode;
        setChatMode(mode);
      });
    });
  });

  // Aplicar visibilidad de modos según preferencias guardadas
  updateChatModeTogglesVisibility();
}

// Crear elemento de progreso de Deep Research con diseño visual mejorado
function createDeepResearchProgressElement() {
  const container = document.createElement('div');
  container.className = 'deep-research-container';
  container.innerHTML = `
    <div class="deep-research-header">
      <div class="deep-research-title">
        <svg class="deep-research-title-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5"/>
          <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" stroke="currentColor" stroke-width="1.5"/>
        </svg>
        <span>Investigación web profunda</span>
      </div>
      <div class="deep-research-header-right">
        <span class="deep-research-status">Preparando investigación...</span>
      </div>
    </div>
    
    <div class="deep-research-progress">
      <div class="deep-research-progress-bar">
        <div class="deep-research-progress-fill" style="width: 0%"></div>
      </div>
      <span class="deep-research-progress-percent">0%</span>
    </div>
    
    <!-- Panel de razonamiento en vivo -->
    <div class="deep-research-reasoning" style="display: none;">
      <div class="reasoning-section active">
        <div class="reasoning-section-header">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
          </svg>
          <span class="reasoning-title">Analizando consulta</span>
        </div>
        <div class="reasoning-content"></div>
      </div>
    </div>
    
    <!-- Pasos de búsqueda -->
    <div class="deep-research-steps"></div>
    
    <!-- Grid de fuentes web encontradas -->
    <div class="deep-research-sources-grid" style="display: none;">
      <div class="sources-grid-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
          <circle cx="12" cy="12" r="10"/>
          <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
        </svg>
        <span>Investigando sitios web</span>
        <span class="sources-count">(0 fuentes)</span>
      </div>
      <div class="sources-grid-content"></div>
    </div>
    
    <!-- Hallazgos clave -->
    <div class="deep-research-findings" style="display: none;">
      <div class="deep-research-findings-title">
        <svg class="findings-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <polyline points="22 4 12 14.01 9 11.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Hallazgos clave
      </div>
      <div class="deep-research-findings-list"></div>
    </div>
    
    <!-- Panel de pensamiento de la IA -->
    <div class="deep-research-thinking" style="display: none;">
      <div class="thinking-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
          <path d="M12 2C7.58 2 4 5.58 4 10c0 2.5 1.2 4.7 3 6.2V19c0 1.1.9 2 2 2h6c1.1 0 2-.9 2-2v-2.8c1.8-1.5 3-3.7 3-6.2 0-4.42-3.58-8-8-8z"/>
          <path d="M9 13v2M12 11v4M15 13v2"/>
        </svg>
        <span>Análisis de la IA</span>
        <span class="thinking-cycle-count">(Ciclo 1)</span>
      </div>
      <div class="thinking-content-list"></div>
    </div>
  `;
  return container;
}

// Añadir fuente web al grid visual
function addWebSourceToGrid(container, source, index) {
  const sourcesGrid = container.querySelector('.deep-research-sources-grid');
  const gridContent = container.querySelector('.sources-grid-content');
  const sourcesCount = container.querySelector('.sources-count');

  if (!sourcesGrid || !gridContent) return;

  // Mostrar el grid si está oculto
  sourcesGrid.style.display = 'block';

  // Obtener dominio y favicon
  let domain = 'web';
  let faviconUrl = '';
  try {
    const url = new URL(source.link);
    domain = url.hostname.replace('www.', '');
    faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
  } catch (e) { }

  // Crear tarjeta de fuente
  const sourceCard = document.createElement('a');
  sourceCard.className = 'source-card';
  sourceCard.href = source.link;
  sourceCard.target = '_blank';
  sourceCard.rel = 'noopener noreferrer';
  sourceCard.style.animationDelay = `${index * 0.05}s`;

  sourceCard.innerHTML = `
    <img class="source-card-favicon" src="${faviconUrl}" alt="" onerror="this.style.display='none'">
    <div class="source-card-info">
      <span class="source-card-domain">${escapeHtml(domain)}</span>
      <span class="source-card-title">${escapeHtml((source.title || '').substring(0, 50))}</span>
    </div>
  `;

  gridContent.appendChild(sourceCard);

  // Actualizar contador
  const currentCount = gridContent.children.length;
  if (sourcesCount) {
    sourcesCount.textContent = `(${currentCount} fuentes)`;
  }
}

// Actualizar razonamiento en vivo
function updateReasoningPanel(container, title, content) {
  const reasoningPanel = container.querySelector('.deep-research-reasoning');
  const reasoningSection = container.querySelector('.reasoning-section');
  const reasoningTitle = container.querySelector('.reasoning-title');
  const reasoningContent = container.querySelector('.reasoning-content');

  if (!reasoningPanel) return;

  reasoningPanel.style.display = 'block';
  if (reasoningTitle) reasoningTitle.textContent = title;
  if (reasoningContent) reasoningContent.textContent = content;
}

// Añadir pensamiento de la IA al panel - VERSIÓN DINÁMICA
let currentTypingInterval = null;
let currentThinkingCycle = 0;

function addAIThinking(container, cycle, thinking) {
  const thinkingPanel = container.querySelector('.deep-research-thinking');
  const thinkingList = container.querySelector('.thinking-content-list');
  const cycleCount = container.querySelector('.thinking-cycle-count');

  if (!thinkingPanel || !thinkingList) return;

  // Mostrar el panel
  thinkingPanel.style.display = 'block';

  // Actualizar contador de ciclos
  currentThinkingCycle = cycle;
  if (cycleCount) {
    cycleCount.textContent = `(Ciclo ${cycle})`;
  }

  // Limpiar markdown
  let cleanThinking = thinking
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/#{1,6}\s/g, '')
    .replace(/`/g, '')
    .trim();

  // NO truncar - mostrar todo el texto

  // Cancelar cualquier escritura en progreso
  if (currentTypingInterval) {
    clearInterval(currentTypingInterval);
    currentTypingInterval = null;
  }

  // Hacer fade out del contenido anterior
  const existingItems = thinkingList.querySelectorAll('.thinking-item');
  existingItems.forEach(item => {
    item.classList.add('fading-out');
    setTimeout(() => item.remove(), 300);
  });

  // Crear nuevo elemento de pensamiento después de un pequeño delay
  setTimeout(() => {
    const thinkingItem = document.createElement('div');
    thinkingItem.className = 'thinking-item typing';
    thinkingItem.innerHTML = `
      <div class="thinking-item-header">
        <span class="thinking-cycle-label">Ciclo ${cycle}</span>
        <span class="thinking-typing-indicator">
          <span></span><span></span><span></span>
        </span>
      </div>
      <div class="thinking-item-content"></div>
    `;

    thinkingList.appendChild(thinkingItem);

    // Efecto de escritura - velocidad más rápida
    const contentEl = thinkingItem.querySelector('.thinking-item-content');
    const typingIndicator = thinkingItem.querySelector('.thinking-typing-indicator');
    let charIndex = 0;
    const charsPerTick = 8; // Velocidad de escritura (más rápida)

    currentTypingInterval = setInterval(() => {
      if (charIndex < cleanThinking.length) {
        charIndex += charsPerTick;
        contentEl.textContent = cleanThinking.substring(0, charIndex);
      } else {
        // Escritura completada
        clearInterval(currentTypingInterval);
        currentTypingInterval = null;
        thinkingItem.classList.remove('typing');
        if (typingIndicator) typingIndicator.style.display = 'none';
      }
    }, 10);

  }, existingItems.length > 0 ? 300 : 0);
}

// Actualizar progreso visual
function updateDeepResearchProgress(container, progress, status) {
  // Guardar estado para poder mostrar en la lista de conversaciones
  deepResearchProgressState = { progress: Math.round(progress), status };

  // Actualizar indicador en la lista de conversaciones
  updateResearchIndicatorInList();

  // Actualizar banner si existe (estamos en otro chat)
  updateResearchBannerProgress();

  // Usar el contenedor pasado o el global como fallback
  let activeContainer = container || deepResearchCurrentContainer;
  if (!activeContainer) return;

  // Si usamos el global, verificar que esté en el DOM
  if (activeContainer === deepResearchCurrentContainer && !document.body.contains(activeContainer)) return;

  const progressFill = activeContainer.querySelector('.deep-research-progress-fill');
  const statusElement = activeContainer.querySelector('.deep-research-status');
  const percentElement = activeContainer.querySelector('.deep-research-progress-percent');

  if (progressFill) {
    progressFill.style.width = `${progress}%`;
  }
  if (statusElement) {
    statusElement.textContent = status;
  }
  if (percentElement) {
    percentElement.textContent = `${Math.round(progress)}%`;
  }
}

// Actualizar solo el progreso del banner (sin recrearlo)
function updateResearchBannerProgress() {
  const banner = document.getElementById('research-progress-banner');
  if (banner && deepResearchProgressState) {
    const progressSpan = banner.querySelector('.research-banner-progress');
    if (progressSpan) {
      progressSpan.textContent = `${deepResearchProgressState.progress}%`;
    }
  }
}

// Actualizar indicador de investigación en la lista de conversaciones
function updateResearchIndicatorInList() {
  if (!deepResearchActiveConversationId) return;

  const conversationItem = document.querySelector(`.conversation-item[data-id="${deepResearchActiveConversationId}"]`);
  if (!conversationItem) return;

  let indicator = conversationItem.querySelector('.research-indicator');

  if (deepResearchProgressState) {
    if (!indicator) {
      indicator = document.createElement('span');
      indicator.className = 'research-indicator';
      const titleSpan = conversationItem.querySelector('.conversation-title');
      if (titleSpan) {
        titleSpan.insertAdjacentElement('afterend', indicator);
      }
    }
    indicator.innerHTML = getResearchIndicator(deepResearchActiveConversationId);
    indicator.title = `Investigando: ${deepResearchProgressState.progress}% - ${deepResearchProgressState.status}`;
  } else if (indicator) {
    indicator.remove();
  }
}

// Mostrar banner cuando estás en otro chat y hay investigación en progreso
function updateResearchBanner(currentConversationId) {
  const existingBanner = document.getElementById('research-progress-banner');

  // Si hay una investigación en progreso en OTRO chat, mostrar banner
  if (deepResearchActiveConversationId &&
    deepResearchActiveConversationId !== currentConversationId &&
    deepResearchProgressState) {

    const researchConversation = state.conversations[deepResearchActiveConversationId];
    const title = researchConversation?.title || 'Investigación';

    if (!existingBanner) {
      const banner = document.createElement('div');
      banner.id = 'research-progress-banner';
      banner.className = 'research-progress-banner';
      banner.innerHTML = `
        <div class="research-banner-content">
          <svg class="research-banner-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <circle class="spinner-ring" cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.5" opacity="0.12"></circle>
            <circle cx="11" cy="11" r="5" stroke="currentColor" stroke-width="1.5" />
            <path d="M15 15l4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          <span class="research-banner-text">
            Investigación en progreso: <strong>${escapeHtml(title.substring(0, 30))}</strong>
          </span>
          <span class="research-banner-progress">${deepResearchProgressState.progress}%</span>
        </div>
        <button class="research-banner-goto" title="Ir a la investigación">
          Ver progreso →
        </button>
      `;

      banner.querySelector('.research-banner-goto').addEventListener('click', () => {
        setActiveConversation(deepResearchActiveConversationId);
      });

      const chatMessages = document.getElementById('chat-messages') || document.getElementById('chat-messages-inline');
      if (chatMessages) {
        chatMessages.parentElement.insertBefore(banner, chatMessages);
      }
    } else {
      // Actualizar el banner existente
      const progressSpan = existingBanner.querySelector('.research-banner-progress');
      if (progressSpan && deepResearchProgressState) {
        progressSpan.textContent = `${deepResearchProgressState.progress}%`;
      }
    }
  } else if (existingBanner) {
    // Remover banner si estamos en el chat de la investigación o no hay investigación
    existingBanner.remove();
  }
}

// Agregar paso de investigación
function addResearchStep(container, step, isActive = false, isCompleted = false) {
  // Guardar datos para restaurar después
  const stepData = { ...step, isActive, isCompleted };
  const existingIndex = deepResearchStepsData.findIndex(s => s.id === step.id);
  if (existingIndex >= 0) {
    deepResearchStepsData[existingIndex] = stepData;
  } else {
    deepResearchStepsData.push(stepData);
  }

  // Usar el contenedor pasado directamente si existe, o el global como fallback
  // Usar el contenedor pasado directamente o el global como fallback
  let activeContainer = container || deepResearchCurrentContainer;

  // Si no hay contenedor disponible, salir
  if (!activeContainer) return;

  // Solo verificar si está en el DOM cuando usamos el contenedor global (no se pasó container)
  // Si se pasó un container directamente, confiamos en él aunque no esté en el DOM aún
  if (!container && !document.body.contains(activeContainer)) return;

  const stepsContainer = activeContainer.querySelector('.deep-research-steps');
  if (!stepsContainer) return;

  // Verificar si ya existe
  const existingStep = stepsContainer.querySelector(`[data-step-id="${step.id}"]`);
  if (existingStep) return existingStep;

  const stepElement = document.createElement('div');
  stepElement.className = `deep-research-step ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}`;
  stepElement.dataset.stepId = step.id;
  stepElement.innerHTML = `
    <div class="deep-research-step-indicator">${isCompleted ? '<svg class="check-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' : `<span class=\"step-number\">${step.number}</span>`}</div>
    <div class="deep-research-step-content">
      <div class="deep-research-step-title">${escapeHtml(step.title)}</div>
      <div class="deep-research-step-description">${escapeHtml(step.description || '')}</div>
    </div>
  `;
  stepsContainer.appendChild(stepElement);
  return stepElement;
}

// Actualizar estado de un paso
function updateResearchStep(container, stepId, updates) {
  // Actualizar datos guardados
  const stepIndex = deepResearchStepsData.findIndex(s => s.id === stepId);
  if (stepIndex >= 0) {
    if (updates.isActive !== undefined) deepResearchStepsData[stepIndex].isActive = updates.isActive;
    if (updates.isCompleted !== undefined) deepResearchStepsData[stepIndex].isCompleted = updates.isCompleted;
    if (updates.description !== undefined) deepResearchStepsData[stepIndex].description = updates.description;
  }

  // Usar el contenedor pasado directamente si existe, o el global como fallback
  let activeContainer = container || deepResearchCurrentContainer;
  if (!activeContainer) return;

  // Solo verificar si está en el DOM cuando usamos el contenedor global
  if (!container && !document.body.contains(activeContainer)) return;

  const stepElement = activeContainer.querySelector(`[data-step-id="${stepId}"]`);
  if (!stepElement) return;

  if (updates.isActive !== undefined) {
    stepElement.classList.toggle('active', updates.isActive);
  }
  if (updates.isCompleted !== undefined) {
    stepElement.classList.toggle('completed', updates.isCompleted);
    if (updates.isCompleted) {
      stepElement.classList.remove('active');
      const indicator = stepElement.querySelector('.deep-research-step-indicator');
      if (indicator) {
        indicator.innerHTML = '<svg class="check-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      }
    }
  }
  if (updates.description !== undefined) {
    const descElement = stepElement.querySelector('.deep-research-step-description');
    if (descElement) {
      descElement.textContent = updates.description;
    }
  }
}

// Agregar hallazgo
function addFinding(container, finding) {
  // Guardar para restaurar después
  if (!deepResearchFindingsData.includes(finding)) {
    deepResearchFindingsData.push(finding);
  }

  // Usar el contenedor pasado directamente si existe, o el global como fallback
  let activeContainer = container || deepResearchCurrentContainer;
  if (!activeContainer) return;

  // Solo verificar si está en el DOM cuando usamos el contenedor global
  if (!container && !document.body.contains(activeContainer)) return;

  const findingsContainer = activeContainer.querySelector('.deep-research-findings');
  const findingsList = activeContainer.querySelector('.deep-research-findings-list');

  if (findingsContainer && findingsList) {
    findingsContainer.style.display = 'block';
    const findingElement = document.createElement('div');
    findingElement.className = 'deep-research-finding';

    // Limpiar markdown del texto (quitar **, *, etc.)
    let cleanFinding = finding
      .replace(/\*\*/g, '')
      .replace(/\*/g, '')
      .replace(/#{1,6}\s/g, '')
      .replace(/`/g, '')
      .trim();

    findingElement.innerHTML = `
      <svg class="finding-item-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z" stroke="currentColor" stroke-width="1.2"/><path d="M9 12l2 2 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <div class="finding-text">${escapeHtml(cleanFinding)}</div>
    `;
    findingsList.appendChild(findingElement);
  }
}

// Generar plan de investigación INTELIGENTE usando el modelo
async function generateResearchPlan(userQuery, signal = null) {
  console.log('🔬 Generando plan de investigación para:', userQuery);

  const planPrompt = `Eres un investigador científico experto. Debes crear un plan de investigación para: "${userQuery}"

ESTRATEGIA:
Genera EXACTAMENTE 4 búsquedas de Google que cubran diferentes aspectos del tema:

1. FUNDAMENTOS: Conceptos básicos, definiciones, qué es y cómo funciona
2. APLICACIONES: Aplicaciones prácticas, ejemplos reales, casos de uso
3. COMPARATIVA: Comparaciones, ventajas/desventajas, alternativas
4. ACTUALIDAD: Novedades 2024-2025, mejores prácticas, tendencias

IMPORTANTE: Cada búsqueda debe aportar información DIFERENTE y COMPLEMENTARIA.

Responde SOLO con JSON válido (sin \`\`\` ni markdown):
{
  "mainQuestion": "Reformulación clara de lo que el usuario quiere saber",
  "searchPlan": [
    {
      "id": "s1",
      "searchQuery": "términos para buscar en Google sobre fundamentos",
      "purpose": "Fundamentos y conceptos básicos",
      "category": "fundamentos"
    },
    {
      "id": "s2",
      "searchQuery": "términos para buscar en Google sobre aplicaciones",
      "purpose": "Aplicaciones prácticas y casos de uso",
      "category": "aplicaciones"
    },
    {
      "id": "s3",
      "searchQuery": "términos para buscar en Google sobre comparación",
      "purpose": "Análisis comparativo y crítico",
      "category": "comparativa"
    },
    {
      "id": "s4",
      "searchQuery": "términos para buscar en Google sobre actualidad",
      "purpose": "Actualidad y mejores prácticas",
      "category": "actualidad"
    }
  ],
  "approach": "Investigación completa"
}

REGLAS:
- Las búsquedas deben usar SOLO términos relacionados con "${userQuery}"
- NO incluyas información de otros temas
- Si hay fechas/lugares específicos en la consulta, úsalos
- Cada búsqueda debe cubrir un aspecto diferente
- Usa términos naturales para Google (no preguntas completas)`;

  try {
    const response = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: state.currentModel,
        stream: false,
        messages: [{ role: 'user', content: planPrompt }],
        options: { temperature: 0.3, num_ctx: 4096 }
      }),
      signal
    });

    if (!response.ok) throw new Error('Error al generar plan');

    const data = await response.json();
    const content = data.message?.content || '';

    // Extraer JSON del contenido
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const plan = JSON.parse(jsonMatch[0]);
      console.log('📋 Plan de investigación generado:', plan);

      // Convertir searchPlan a subQuestions para compatibilidad
      if (plan.searchPlan && !plan.subQuestions) {
        plan.subQuestions = plan.searchPlan.map(s => ({
          id: s.id,
          question: s.searchQuery,
          purpose: s.purpose,
          category: s.category
        }));
      }

      return plan;
    }

    throw new Error('No se pudo parsear el plan');
  } catch (error) {
    console.error('Error generando plan:', error);
    // Plan de fallback INTELIGENTE basado en la consulta
    const queryLower = userQuery.toLowerCase();
    let fallbackSearches = [];

    // Detectar tipo de consulta y generar búsquedas apropiadas
    if (queryLower.includes('vuelo') || queryLower.includes('avión') || queryLower.includes('volar')) {
      // Extraer ciudades y fechas si es posible
      const words = userQuery.split(' ');
      fallbackSearches = [
        { id: 's1', question: `${userQuery} precios comparativa`, purpose: 'Encontrar precios y comparativas' },
        { id: 's2', question: `ofertas vuelos baratos ${userQuery}`, purpose: 'Buscar ofertas y descuentos' },
        { id: 's3', question: `mejores aerolíneas ${userQuery} opiniones`, purpose: 'Evaluar aerolíneas disponibles' },
        { id: 's4', question: `consejos reservar vuelo barato ${userQuery}`, purpose: 'Tips para conseguir mejor precio' }
      ];
    } else if (queryLower.includes('hotel') || queryLower.includes('alojamiento')) {
      fallbackSearches = [
        { id: 's1', question: `${userQuery} mejores opciones`, purpose: 'Encontrar mejores opciones' },
        { id: 's2', question: `${userQuery} precios baratos`, purpose: 'Comparar precios' },
        { id: 's3', question: `${userQuery} opiniones reseñas`, purpose: 'Ver valoraciones de usuarios' }
      ];
    } else if (queryLower.includes('precio') || queryLower.includes('comprar') || queryLower.includes('barato')) {
      fallbackSearches = [
        { id: 's1', question: `${userQuery} comparativa precios`, purpose: 'Comparar precios' },
        { id: 's2', question: `${userQuery} mejores ofertas`, purpose: 'Encontrar ofertas' },
        { id: 's3', question: `${userQuery} opiniones 2024`, purpose: 'Ver opiniones recientes' }
      ];
    } else {
      // Búsquedas genéricas pero útiles
      fallbackSearches = [
        { id: 's1', question: `${userQuery} guía completa`, purpose: 'Información general detallada' },
        { id: 's2', question: `${userQuery} mejores opciones 2024`, purpose: 'Opciones actualizadas' },
        { id: 's3', question: `${userQuery} consejos expertos`, purpose: 'Recomendaciones de expertos' },
        { id: 's4', question: `${userQuery} comparativa análisis`, purpose: 'Análisis comparativo' }
      ];
    }

    return {
      mainQuestion: userQuery,
      subQuestions: fallbackSearches,
      approach: 'Búsqueda web exhaustiva de múltiples fuentes'
    };
  }
}

// Investigar una sub-pregunta
async function investigateSubQuestion(question, previousFindings = [], signal = null) {
  console.log('🔍 Investigando:', question);

  let contextFromFindings = '';
  if (previousFindings.length > 0) {
    contextFromFindings = `\n\nContexto de hallazgos previos:\n${previousFindings.map((f, i) => `${i + 1}. ${f}`).join('\n')}`;
  }

  const investigatePrompt = `Investiga la siguiente pregunta de forma detallada y estructurada:

"${question}"${contextFromFindings}

Proporciona una respuesta completa y bien fundamentada. Incluye:
1. Explicación clara del concepto
2. Datos o ejemplos relevantes
3. Puntos clave a recordar

Responde de forma directa y útil.`;

  try {
    const response = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: state.currentModel,
        stream: false,
        messages: [{ role: 'user', content: investigatePrompt }],
        options: { temperature: 0.5, num_ctx: 8192 }
      }),
      signal
    });

    if (!response.ok) throw new Error('Error en investigación');

    const data = await response.json();
    const content = data.message?.content || '';

    return {
      question: question,
      answer: content,
      keyPoints: extractKeyPoints(content)
    };
  } catch (error) {
    // Re-lanzar errores de cancelación
    if (error.name === 'AbortError') {
      throw error;
    }
    console.error('Error investigando:', error);
    return {
      question: question,
      answer: 'No se pudo completar esta parte de la investigación.',
      keyPoints: []
    };
  }
}

// Extraer puntos clave de una respuesta
function extractKeyPoints(text) {
  const points = [];

  // Buscar puntos numerados o con viñetas
  const patterns = [
    /(?:^|\n)\s*(?:\d+[\.\)]\s*|\-\s*|\•\s*|\*\s*)([^\n]+)/g,
    /(?:^|\n)\s*(?:Punto clave|Key point|Importante|Nota):\s*([^\n]+)/gi
  ];

  patterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(text)) !== null && points.length < 5) {
      const point = match[1].trim();
      if (point.length > 10 && point.length < 200 && !points.includes(point)) {
        points.push(point);
      }
    }
  });

  // Si no encontramos puntos estructurados, extraer oraciones importantes
  if (points.length === 0) {
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 30);
    points.push(...sentences.slice(0, 3).map(s => s.trim()));
  }

  return points.slice(0, 5);
}

// Generar preguntas de seguimiento
async function generateFollowUpQuestions(findings, originalQuery, signal = null) {
  console.log('🔄 Generando preguntas de seguimiento...');

  const summaryOfFindings = findings.map(f => `- ${f.question}: ${f.keyPoints.join('; ')}`).join('\n');

  const followUpPrompt = `Basándote en la investigación realizada sobre "${originalQuery}":

Hallazgos hasta ahora:
${summaryOfFindings}

¿Qué aspectos adicionales valdría la pena investigar? Responde SOLO con un JSON:
{
  "followUpQuestions": [
    {"id": "f1", "question": "Pregunta de seguimiento 1"},
    {"id": "f2", "question": "Pregunta de seguimiento 2"}
  ],
  "shouldContinue": true/false
}

Si ya se ha cubierto suficiente, pon shouldContinue: false.`;

  try {
    const response = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: state.currentModel,
        stream: false,
        messages: [{ role: 'user', content: followUpPrompt }],
        options: { temperature: 0.4 }
      }),
      signal
    });

    if (!response.ok) return { followUpQuestions: [], shouldContinue: false };

    const data = await response.json();
    const content = data.message?.content || '';

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }

    return { followUpQuestions: [], shouldContinue: false };
  } catch (error) {
    // Re-lanzar errores de cancelación
    if (error.name === 'AbortError') {
      throw error;
    }
    console.error('Error generando follow-ups:', error);
    return { followUpQuestions: [], shouldContinue: false };
  }
}

// Sintetizar todos los hallazgos en un informe final
async function synthesizeFindings(originalQuery, findings, signal = null) {
  console.log('📝 Sintetizando informe final...');

  const findingsSummary = findings.map((f, i) =>
    `## Investigación ${i + 1}: ${f.question}\n\n${f.answer}`
  ).join('\n\n---\n\n');

  // Detectar tipo de consulta para adaptar el formato
  const queryLower = originalQuery.toLowerCase();
  const isTravel = queryLower.includes('vuelo') || queryLower.includes('hotel') || queryLower.includes('viaje') || queryLower.includes('billete');
  const isProduct = queryLower.includes('comprar') || queryLower.includes('precio') || queryLower.includes('mejor') || queryLower.includes('comparar');

  let formatInstructions = '';
  if (isTravel) {
    formatInstructions = `
FORMATO ESPECÍFICO PARA VIAJES:
1. **METODOLOGÍA DE BÚSQUEDA**: Explica brevemente cómo se realizó la investigación
2. **TABLA COMPARATIVA**: Crea una tabla markdown con columnas para: Opción, Aerolínea/Proveedor, Precio, Horarios, Duración, Observaciones
   - Incluye SIEMPRE datos específicos encontrados (precios reales, horarios, etc.)
   - Formato de tabla: | Columna1 | Columna2 | Columna3 |
3. **ANÁLISIS DETALLADO**: Para las 2-3 mejores opciones, explica pros y contras
4. **RECOMENDACIÓN FINAL**: Da UNA recomendación clara y justificada
5. **CONSEJOS ADICIONALES**: Tips para conseguir mejor precio o alternativas`;
  } else if (isProduct) {
    formatInstructions = `
FORMATO ESPECÍFICO PARA PRODUCTOS/COMPARATIVAS:
1. **METODOLOGÍA**: Criterios de evaluación utilizados
2. **TABLA COMPARATIVA**: Crea una tabla markdown con las opciones encontradas
   - Incluye: Producto, Precio, Características clave, Puntuación/Rating
   - Formato de tabla: | Columna1 | Columna2 | Columna3 |
3. **ANÁLISIS**: Ventajas y desventajas de cada opción
4. **MEJOR OPCIÓN**: Recomendación clara con justificación
5. **ALTERNATIVAS**: Otras opciones a considerar`;
  } else {
    formatInstructions = `
FORMATO GENERAL:
1. **RESUMEN EJECUTIVO**: Síntesis de los puntos más importantes
2. **ANÁLISIS DETALLADO**: Información estructurada por temas
3. **DATOS CLAVE**: Si hay datos comparables, inclúyelos en una tabla markdown
4. **CONCLUSIONES**: Puntos principales y recomendaciones`;
  }

  const synthesisPrompt = `Eres un experto analista que crea informes profesionales. Se realizó una investigación profunda sobre: "${originalQuery}"

Hallazgos de la investigación:
${findingsSummary}

Tu tarea es crear un INFORME FINAL PROFESIONAL siguiendo este formato:
${formatInstructions}

REGLAS IMPORTANTES:
- Usa formato Markdown con tablas cuando sea apropiado (| col1 | col2 |)
- Incluye DATOS ESPECÍFICOS encontrados (precios, fechas, nombres, etc.)
- Sé concreto y útil, no genérico
- Si hay varias opciones, compáralas visualmente en una tabla
- Termina SIEMPRE con una recomendación clara y accionable
- El informe debe ser comprehensivo pero directo al punto`;

  try {
    const response = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: state.currentModel,
        stream: false,
        messages: [{ role: 'user', content: synthesisPrompt }],
        options: { temperature: 0.4, num_ctx: 16384 }
      }),
      signal
    });

    if (!response.ok) throw new Error('Error en síntesis');

    const data = await response.json();
    return data.message?.content || 'No se pudo generar el informe final.';
  } catch (error) {
    // Re-lanzar errores de cancelación
    if (error.name === 'AbortError') {
      throw error;
    }
    console.error('Error sintetizando:', error);

    // Generar un informe básico con los hallazgos
    return `# Informe de Investigación: ${originalQuery}\n\n${findings.map(f =>
      `## ${f.question}\n\n${f.answer}`
    ).join('\n\n---\n\n')}\n\n## Conclusión\n\nEsta investigación exploró múltiples aspectos del tema.`;
  }
}

// Función principal de Deep Think
async function executeDeepResearch(userQuery, conversation) {
  console.log('🔬 Iniciando Deep Research:', userQuery);

  console.log('🧠 Iniciando Deep Think:', userQuery);

  // Configurar control de cancelación y tiempo
  deepResearchAbortController = new AbortController();
  deepResearchActiveConversationId = conversation.id;
  deepResearchStartTime = Date.now();
  deepResearchStepTimes = [];
  deepResearchStepsData = []; // Resetear pasos
  deepResearchFindingsData = []; // Resetear hallazgos
  const signal = deepResearchAbortController.signal;

  // Bloquear inputs mientras investiga
  lockInputsDuringResearch();

  // Helper para verificar si fue cancelado
  const checkCancelled = () => {
    if (signal.aborted) {
      throw new DOMException('Deep Research cancelado', 'AbortError');
    }
  };

  // Crear mensaje del usuario
  const userMessage = createMessage('user', `Investigación profunda: ${userQuery}`);
  conversation.messages.push(userMessage);
  touchConversation(conversation.id);

  showChatState();
  appendMessageElement(userMessage);
  updateConversationTitleFromContent(conversation);

  // Crear mensaje del asistente con el contenedor de progreso
  const assistantMessage = createMessage('assistant', '');
  assistantMessage.isDeepResearchInProgress = true; // Marcar como Deep Research activo
  assistantMessage.model = state.currentModel; // Guardar el modelo usado
  conversation.messages.push(assistantMessage);

  // Guardar el ID del mensaje para poder restaurar el UI
  deepResearchMessageId = assistantMessage.id;

  const { bubble } = appendMessageElement(assistantMessage);

  // Crear y agregar el contenedor de progreso
  const progressContainer = createDeepResearchProgressElement();
  bubble.innerHTML = '';
  bubble.appendChild(progressContainer);

  // Guardar referencia al contenedor actual
  deepResearchCurrentContainer = progressContainer;

  // Guardar referencia para actualizar desde cualquier lugar
  const conversationId = conversation.id;

  const findings = [];
  let iteration = 0;
  let stepsCompleted = 0;
  let totalExpectedSteps = 3; // Empezamos con 3 sub-preguntas + posibles follow-ups

  try {
    checkCancelled();
    // Fase 1: Generar plan de investigación
    updateDeepResearchProgress(progressContainer, 5, 'Generando plan de investigación...');
    const plan = await generateResearchPlan(userQuery, signal);

    checkCancelled(); // Verificar después del plan

    // Actualizar total de pasos esperados
    totalExpectedSteps = plan.subQuestions.length + 2; // +2 para follow-ups y síntesis

    // Mostrar pasos del plan
    updateDeepResearchProgress(progressContainer, 10, `Investigando: ${plan.mainQuestion}`);

    const totalSteps = plan.subQuestions.length;

    // Agregar pasos iniciales
    plan.subQuestions.forEach((q, i) => {
      addResearchStep(progressContainer, {
        id: q.id,
        number: i + 1,
        title: q.question,
        description: q.purpose
      }, i === 0, false);
    });

    // Fase 2: Investigar cada sub-pregunta
    for (let i = 0; i < plan.subQuestions.length && iteration < MAX_RESEARCH_ITERATIONS; i++) {
      checkCancelled(); // Verificar si fue cancelado

      const subQ = plan.subQuestions[i];
      const stepStartTime = Date.now();

      updateResearchStep(progressContainer, subQ.id, { isActive: true });
      const currentProgress = 10 + ((i + 1) / totalSteps) * 60;
      updateDeepResearchProgress(
        progressContainer,
        currentProgress,
        `Investigando: ${subQ.question.substring(0, 50)}...`
      );

      const result = await investigateSubQuestion(
        subQ.question,
        findings.map(f => f.keyPoints).flat(),
        signal
      );

      // Registrar tiempo del paso
      deepResearchStepTimes.push(Date.now() - stepStartTime);
      stepsCompleted++;

      checkCancelled(); // Verificar después de cada investigación

      findings.push(result);

      // Agregar hallazgos clave
      result.keyPoints.slice(0, 2).forEach(point => {
        addFinding(progressContainer, point);
      });

      updateResearchStep(progressContainer, subQ.id, {
        isActive: false,
        isCompleted: true,
        description: `${result.keyPoints.length} puntos clave encontrados`
      });

      iteration++;
      scrollChatToBottom();
    }

    // Fase 2.5: Preguntas de seguimiento (opcional)
    if (iteration < MAX_RESEARCH_ITERATIONS) {
      checkCancelled();
      updateDeepResearchProgress(progressContainer, 75, 'Evaluando si se necesita más investigación...');

      const followUp = await generateFollowUpQuestions(findings, userQuery, signal);

      checkCancelled();

      if (followUp.shouldContinue && followUp.followUpQuestions.length > 0) {
        const additionalQuestions = followUp.followUpQuestions.slice(0, MAX_FOLLOW_UP_QUESTIONS);
        totalExpectedSteps += additionalQuestions.length; // Actualizar total

        for (let i = 0; i < additionalQuestions.length && iteration < MAX_RESEARCH_ITERATIONS; i++) {
          checkCancelled(); // Verificar si fue cancelado

          const fq = additionalQuestions[i];
          const stepStartTime = Date.now();

          addResearchStep(progressContainer, {
            id: fq.id,
            number: findings.length + 1,
            title: fq.question,
            description: 'Pregunta de seguimiento'
          }, true, false);

          const currentProgress = 75 + ((i + 1) / additionalQuestions.length) * 15;
          updateDeepResearchProgress(
            progressContainer,
            currentProgress,
            `Profundizando: ${fq.question.substring(0, 40)}...`
          );

          const result = await investigateSubQuestion(
            fq.question,
            findings.map(f => f.keyPoints).flat(),
            signal
          );

          // Registrar tiempo del paso
          deepResearchStepTimes.push(Date.now() - stepStartTime);
          stepsCompleted++;

          checkCancelled(); // Verificar después de cada investigación

          findings.push(result);

          result.keyPoints.slice(0, 2).forEach(point => {
            addFinding(progressContainer, point);
          });

          updateResearchStep(progressContainer, fq.id, {
            isActive: false,
            isCompleted: true
          });

          iteration++;
          scrollChatToBottom();
        }
      }
    }

    // Fase 3: Sintetizar resultados
    checkCancelled();
    updateDeepResearchProgress(progressContainer, 90, 'Generando informe final...');

    const finalReport = await synthesizeFindings(userQuery, findings, signal);

    checkCancelled();

    // Calcular tiempo total
    const totalTime = Date.now() - deepResearchStartTime;
    const totalMinutes = Math.floor(totalTime / 60000);
    const totalSeconds = Math.floor((totalTime % 60000) / 1000);
    const timeString = totalMinutes > 0 ? `${totalMinutes}m ${totalSeconds}s` : `${totalSeconds}s`;

    // Actualizar el mensaje con el informe final
    updateDeepResearchProgress(progressContainer, 100, `✅ Completado en ${timeString}`);

    // Guardar el ID de la conversación actual para verificar después
    const currentConversationId = conversation.id;

    // IMPORTANTE: Guardar los datos del mensaje INMEDIATAMENTE (antes de limpiar variables globales)
    // Quitar el flag de investigación en progreso
    assistantMessage.isDeepResearchInProgress = false;
    assistantMessage.content = finalReport;
    assistantMessage.deepResearch = {
      query: userQuery,
      findings: findings.length,
      iterations: iteration
    };
    conversation.updatedAt = Date.now();
    persistState();

    // Función para renderizar el informe final en el bubble
    const renderFinalReport = () => {
      // Si el usuario cambió de chat, re-renderizar se hará cuando vuelva (por appendMessageElement)
      if (state.activeId !== currentConversationId) {
        console.log('🔬 Deep Research completado en otro chat, el informe se mostrará al volver');
        renderConversationList();
        return;
      }

      // Si el bubble ya no existe en el DOM, re-renderizar la conversación completa
      if (!bubble || !document.body.contains(bubble)) {
        console.log('🔬 Re-renderizando conversación con informe completado');
        renderActiveConversation();
        return;
      }

      // El usuario sigue en el chat y el bubble existe, actualizar directamente
      bubble.innerHTML = `
        <div class="deep-research-report">
          <div class="deep-research-report-header">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="7"/>
              <path d="M11 8v6M8 11h6"/>
              <path d="M16 16l4 4"/>
            </svg>
            Investigación profunda • ${findings.length} temas investigados
          </div>
        </div>
        ${parseMarkdown(finalReport)}
      `;

      // Agregar contenedor de copiar
      const copyContainer = document.createElement('div');
      copyContainer.className = 'copy-message-container';

      const copyButton = document.createElement('button');
      copyButton.className = 'copy-message-btn';
      copyButton.title = 'Copiar informe';
      copyButton.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
      copyButton.addEventListener('click', async () => {
        await copyToClipboard(finalReport, copyButton);
      });

      copyContainer.appendChild(copyButton);
      
      // Añadir indicador de modelo si existe
      if (assistantMessage.model) {
        const modelIndicator = document.createElement('span');
        modelIndicator.className = 'message-model-indicator';
        
        // Mostrar modelo y tokens/segundo si está disponible
        let displayText = assistantMessage.model;
        if (assistantMessage.tokensPerSecond && assistantMessage.tokensPerSecond > 0) {
          displayText += ` • ${assistantMessage.tokensPerSecond} t/s`;
        }
        
        modelIndicator.textContent = displayText;
        modelIndicator.title = `Respondido por ${assistantMessage.model}${assistantMessage.tokensPerSecond ? ` (${assistantMessage.tokensPerSecond} tokens/segundo)` : ''}`;
        copyContainer.appendChild(modelIndicator);
      }
      
      const timeElement = document.createElement('span');
      timeElement.className = 'message-time';
      timeElement.textContent = formatTime(Date.now());

      copyContainer.appendChild(timeElement);
      bubble.appendChild(copyContainer);

      // Renderizar matemáticas
      if (typeof renderMathInElement !== 'undefined') {
        renderMathInElement(bubble, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$', right: '$', display: false }
          ],
          throwOnError: false
        });
      }

      renderConversationList();
      scrollChatToBottom();
    };

    // Mostrar el informe después de un breve momento para que el usuario vea "Completado"
    setTimeout(renderFinalReport, 1500);

  } catch (error) {
    // Quitar el flag de investigación en progreso
    assistantMessage.isDeepResearchInProgress = false;

    // Manejar cancelación de forma silenciosa
    if (error.name === 'AbortError') {
      console.log('🛑 Deep Research cancelado por el usuario');
      assistantMessage.content = `⚠️ Investigación cancelada`;
      if (bubble && document.body.contains(bubble)) {
        bubble.innerHTML = parseMarkdown(assistantMessage.content);
      }
      persistState();
    } else {
      console.error('Error en Deep Research:', error);
      assistantMessage.content = `⚠️ Error durante la investigación: ${error.message}`;
      if (bubble && document.body.contains(bubble)) {
        bubble.innerHTML = parseMarkdown(assistantMessage.content);
      }
      persistState();
    }
  } finally {
    // Limpiar estado de cancelación y desbloquear inputs
    deepResearchAbortController = null;
    deepResearchActiveConversationId = null;
    deepResearchStartTime = null;
    deepResearchStepTimes = [];
    deepResearchProgressState = null;
    deepResearchMessageId = null;
    deepResearchCurrentContainer = null;
    deepResearchStepsData = [];
    deepResearchFindingsData = [];
    unlockInputsDuringResearch();

    // Limpiar indicadores visuales
    document.querySelectorAll('.research-indicator').forEach(el => el.remove());
    const banner = document.getElementById('research-progress-banner');
    if (banner) banner.remove();
  }

  // Desactivar modo Deep Research después de completar
  if (deepResearchMode) {
    toggleDeepResearch();
  }

  return findings;
}

// Modificar el handleSubmit original para soportar Deep Research, Modo Estudio y Modo Web
const originalHandleSubmit = handleSubmit;

// ========================================
// Sistema de Investigación Web con PDF
// ========================================
let webResearchCurrentPdfUrl = null;
let webResearchAllSources = [];
const MAX_WEB_SEARCH_ITERATIONS = 3; // Iteraciones de búsqueda por sub-pregunta

// Investigar una sub-pregunta CON BÚSQUEDA WEB ITERATIVA
async function investigateSubQuestionWithWeb(question, previousFindings = [], signal = null, progressCallback = null) {
  console.log('🔍🌐 Investigando con búsqueda web:', question);

  let allWebResults = [];
  let accumulatedContext = '';
  let currentAnswer = '';

  // Construir contexto de hallazgos previos (solo los títulos, no el contenido completo)
  let contextFromFindings = '';
  if (previousFindings.length > 0) {
    contextFromFindings = `\n\nTemas ya investigados (NO repitas esta información):\n${previousFindings.slice(0, 3).map((f, i) => `${i + 1}. ${f.substring(0, 80)}`).join('\n')}`;
  }

  // CICLO ITERATIVO: Buscar → Razonar → ¿Necesita más? → Buscar...
  for (let iteration = 0; iteration < MAX_WEB_SEARCH_ITERATIONS; iteration++) {
    if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');

    // Determinar qué buscar
    let searchQuery = question;
    if (iteration > 0 && currentAnswer) {
      // En iteraciones posteriores, generar una búsqueda más específica
      const refinePrompt = `Basándote en esta información parcial sobre "${question}":
${currentAnswer.substring(0, 500)}...

¿Qué término de búsqueda específico ayudaría a completar o profundizar esta investigación? 
Responde SOLO con el término de búsqueda, sin explicaciones.`;

      try {
        const refineResponse = await fetch(`${API_BASE}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: state.currentModel,
            stream: false,
            messages: [{ role: 'user', content: refinePrompt }],
            options: { temperature: 0.3, num_ctx: 2048 }
          }),
          signal
        });
        if (refineResponse.ok) {
          const refineData = await refineResponse.json();
          const refinedQuery = refineData.message?.content?.trim();
          if (refinedQuery && refinedQuery.length < 100) {
            searchQuery = refinedQuery;
          }
        }
      } catch (e) {
        console.log('Usando búsqueda original');
      }
    }

    // Notificar progreso
    if (progressCallback) {
      progressCallback(`🌐 Buscando: "${searchQuery.substring(0, 50)}..."`);
    }

    // PASO 1: Buscar en la web
    console.log(`🔍 Iteración ${iteration + 1}: Buscando "${searchQuery}"`);
    const searchResults = await searchWeb(searchQuery);

    if (searchResults && searchResults.organic) {
      // Guardar resultados para las fuentes
      const newSources = [];
      searchResults.organic.forEach(result => {
        if (!allWebResults.find(r => r.link === result.link)) {
          allWebResults.push(result);
          newSources.push(result);
        }
      });

      // Notificar nuevas fuentes encontradas para mostrar visualmente
      if (progressCallback && newSources.length > 0) {
        progressCallback(`🌐 Encontradas ${newSources.length} fuentes nuevas`, { sources: newSources });
      }

      // Formatear contexto de búsqueda
      const webContext = formatSearchResults(searchResults);
      accumulatedContext += `\n\n--- Búsqueda ${iteration + 1}: "${searchQuery}" ---\n${webContext}`;
    }

    // PASO 2: Razonar con el contexto acumulado
    if (progressCallback) {
      progressCallback(`🧠 Analizando resultados (iteración ${iteration + 1}/${MAX_WEB_SEARCH_ITERATIONS})...`);
    }

    // Determinar el enfoque según la búsqueda
    let focusInstruction = '';
    const queryLower = question.toLowerCase();

    if (queryLower.includes('fundamentos') || queryLower.includes('explicación') || queryLower.includes('qué es') || queryLower.includes('cómo funciona')) {
      focusInstruction = `
ENFOQUE: FUNDAMENTOS Y CONCEPTOS
- Define claramente el concepto principal
- Explica cómo funciona de forma comprensible
- Incluye principios básicos y teoría subyacente
- Usa analogías si ayuda a la comprensión`;
    } else if (queryLower.includes('aplicaciones') || queryLower.includes('casos') || queryLower.includes('ejemplos') || queryLower.includes('uso')) {
      focusInstruction = `
ENFOQUE: APLICACIONES PRÁCTICAS
- Describe aplicaciones reales y casos de uso específicos
- Incluye ejemplos concretos de implementación
- Menciona industrias o contextos donde se usa
- Destaca resultados o beneficios obtenidos`;
    } else if (queryLower.includes('comparativa') || queryLower.includes('vs') || queryLower.includes('ventajas') || queryLower.includes('desventajas')) {
      focusInstruction = `
ENFOQUE: ANÁLISIS COMPARATIVO
- Compara con alternativas o competidores
- Lista ventajas y desventajas claramente
- Analiza criterios de selección
- Proporciona recomendaciones según escenarios`;
    } else if (queryLower.includes('2024') || queryLower.includes('2025') || queryLower.includes('mejores') || queryLower.includes('actualidad') || queryLower.includes('tendencias')) {
      focusInstruction = `
ENFOQUE: ACTUALIDAD Y MEJORES PRÁCTICAS
- Destaca información actualizada (2024-2025)
- Menciona últimas tendencias y novedades
- Incluye mejores prácticas recomendadas actualmente
- Cita herramientas, versiones o métodos modernos`;
    } else if (queryLower.includes('precio') || queryLower.includes('coste') || queryLower.includes('tarifa')) {
      focusInstruction = `
ENFOQUE: PRECIOS Y OPCIONES
- Presenta rangos de precios específicos encontrados
- Compara opciones disponibles con sus costes
- Incluye factores que afectan al precio
- Menciona ofertas o descuentos si se encuentran`;
    }

    const investigatePrompt = `Eres un investigador científico experto. Tu tarea es analizar información web y responder de forma clara, estructurada y profesional.

PREGUNTA DE INVESTIGACIÓN: "${question}"
${contextFromFindings}
${focusInstruction}

INFORMACIÓN DE BÚSQUEDA WEB:
${accumulatedContext}

INSTRUCCIONES CRÍTICAS:
1. Analiza TODA la información de las fuentes web proporcionadas
2. NO repitas información de temas ya investigados
3. Enfócate SOLO en el aspecto específico de esta búsqueda
4. Proporciona una respuesta COMPLETA, bien estructurada y profesional
5. Incluye datos específicos, números, estadísticas o ejemplos concretos de las fuentes
6. Usa subtítulos (##) para organizar secciones
7. Usa listas con bullets (•) para enumerar puntos clave
8. Usa **negritas** para destacar conceptos importantes
9. Si hay tablas de datos, preséntelas en formato markdown
10. Estructura tu respuesta para que sea útil en un informe profesional

FORMATO DE RESPUESTA:
## [Título descriptivo]

[Introducción breve]

### [Subtítulo 1]
• **Concepto clave**: Explicación
• Punto relevante con datos específicos

### [Subtítulo 2]
[Contenido bien estructurado]

Proporciona tu análisis completo y profesional:`;

    try {
      const response = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: state.currentModel,
          stream: false,
          messages: [{ role: 'user', content: investigatePrompt }],
          options: { temperature: 0.4, num_ctx: 16384 }
        }),
        signal
      });

      if (!response.ok) throw new Error('Error en investigación');

      const data = await response.json();
      currentAnswer = data.message?.content || '';

      // Notificar el pensamiento de la IA para mostrar en el panel
      if (progressCallback && currentAnswer) {
        progressCallback(`🧠 Análisis completado`, { thinking: currentAnswer, cycle: iteration + 1 });
      }

    } catch (error) {
      if (error.name === 'AbortError') throw error;
      console.error('Error investigando:', error);
    }
  }

  return {
    question: question,
    answer: currentAnswer,
    keyPoints: extractKeyPoints(currentAnswer),
    sources: allWebResults.slice(0, 8), // Máximo 8 fuentes por pregunta
    webSearchPerformed: true
  };
}

// Generar informe PDF profesional minimalista
function generateResearchPDF(query, findings, synthesis, allSources) {
  console.log('📄 Generando informe PDF profesional...');

  try {
    if (!window.jspdf) {
      throw new Error('jsPDF no está cargado');
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    console.log('✅ jsPDF inicializado correctamente');

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 25;
    const contentWidth = pageWidth - (margin * 2);
    let yPos = margin;

    // ========== COLORES MINIMALISTAS (solo blanco/negro/gris) ==========
    const colors = {
      black: [0, 0, 0],
      darkGray: [60, 60, 60],
      mediumGray: [120, 120, 120],
      lightGray: [180, 180, 180],
      veryLightGray: [240, 240, 240],
      white: [255, 255, 255]
    };

    // ========== FUNCIONES AUXILIARES ==========
    const checkNewPage = (requiredSpace = 20) => {
      if (yPos + requiredSpace > pageHeight - margin) {
        doc.addPage();
        addPageHeader();
        yPos = margin + 15;
        return true;
      }
      return false;
    };

    const addPageHeader = () => {
      // Logo en la esquina superior izquierda
      try {
        const logoImg = new Image();
        logoImg.src = '/assets/Logo.png';
        doc.addImage(logoImg, 'PNG', margin, 10, 15, 15);
      } catch (e) {
        // Si no hay logo, mostrar texto simple
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...colors.darkGray);
        doc.text('OLLAMA WEB', margin, 15);
      }

      // Línea separadora delgada
      doc.setDrawColor(...colors.lightGray);
      doc.setLineWidth(0.3);
      doc.line(margin, margin - 2, pageWidth - margin, margin - 2);
    };

    const cleanMarkdown = (text, preserveBold = false) => {
      if (!text) return '';
      let cleaned = text
        .replace(/#{1,6}\s+/g, '')
        .replace(/`(.+?)`/g, '$1')
        .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      if (!preserveBold) {
        cleaned = cleaned
          .replace(/\*\*(.+?)\*\*/g, '$1')
          .replace(/\*(.+?)\*/g, '$1');
      }

      return cleaned;
    };

    const renderTextWithBold = (text, x, y, maxWidth) => {
      // Renderizar texto con soporte para **negritas**
      const parts = [];
      let remaining = text;
      let currentX = x;
      let currentY = y;

      // Dividir por **texto** para detectar negritas
      const boldRegex = /\*\*(.+?)\*\*/g;
      let lastIndex = 0;
      let match;

      while ((match = boldRegex.exec(text)) !== null) {
        // Texto antes de la negrita
        if (match.index > lastIndex) {
          parts.push({ text: text.substring(lastIndex, match.index), bold: false });
        }
        // Texto en negrita
        parts.push({ text: match[1], bold: true });
        lastIndex = match.index + match[0].length;
      }

      // Texto restante
      if (lastIndex < text.length) {
        parts.push({ text: text.substring(lastIndex), bold: false });
      }

      // Si no hay negritas, renderizar normal
      if (parts.length === 0) {
        parts.push({ text: text, bold: false });
      }

      // Renderizar cada parte
      parts.forEach(part => {
        doc.setFont('helvetica', part.bold ? 'bold' : 'normal');
        const lines = doc.splitTextToSize(part.text, maxWidth - (currentX - x));

        lines.forEach((line, idx) => {
          if (idx > 0) {
            currentY += 5;
            currentX = x;
            checkNewPage(6);
          }
          doc.text(line, currentX, currentY);
          currentX += doc.getTextWidth(line);

          // Si llegamos al final de la línea, nueva línea
          if (currentX > x + maxWidth - 10) {
            currentY += 5;
            currentX = x;
            checkNewPage(6);
          }
        });
      });

      return currentY;
    };

    const parseContent = (text) => {
      // Parsear el texto en secciones estructuradas
      const sections = [];
      const lines = text.split('\n');
      let currentSection = null;
      let currentContent = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // Detectar títulos (líneas que empiezan con #)
        if (trimmed.match(/^#{1,3}\s+(.+)$/)) {
          // Guardar sección anterior
          if (currentSection || currentContent.length > 0) {
            sections.push({
              title: currentSection,
              content: currentContent.join('\n').trim(),
              type: 'section'
            });
          }

          const titleMatch = trimmed.match(/^#{1,3}\s+(.+)$/);
          currentSection = cleanMarkdown(titleMatch[1]);
          currentContent = [];
        }
        // Contenido normal
        else if (trimmed.length > 0) {
          currentContent.push(line);
        }
        // Línea vacía - separador de párrafos
        else if (currentContent.length > 0) {
          currentContent.push('');
        }
      }

      // Guardar última sección
      if (currentSection || currentContent.length > 0) {
        sections.push({
          title: currentSection,
          content: currentContent.join('\n').trim(),
          type: 'section'
        });
        currentSection = null;
      }

      return sections;
    };

    const parseMarkdownTables = (text) => {
      const tables = [];
      const lines = text.split('\n');
      let currentTable = null;
      let headerFound = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // Detectar línea de tabla
        if (line.startsWith('|') && line.endsWith('|')) {
          // Detectar separador de cabecera (|---|---|)
          if (line.match(/^\|[\s\-:|]+\|$/)) {
            if (currentTable) {
              headerFound = true;
            }
            continue;
          }

          // Parsear celdas
          const cells = line.split('|')
            .slice(1, -1)
            .map(c => c.trim())
            .filter(c => c.length > 0);

          if (cells.length === 0) continue;

          if (!currentTable) {
            // Primera línea - asumimos que es header
            currentTable = { headers: cells, rows: [] };
          } else if (!headerFound) {
            // Si no hemos visto separador, esta línea es header
            currentTable.headers = cells;
          } else {
            // Es una fila de datos
            currentTable.rows.push(cells);
          }
        } else {
          // Línea no es tabla
          if (currentTable && headerFound && currentTable.rows.length > 0) {
            // Guardar tabla completa
            tables.push(currentTable);
          }
          currentTable = null;
          headerFound = false;
        }
      }

      // Guardar última tabla si existe
      if (currentTable && headerFound && currentTable.rows.length > 0) {
        tables.push(currentTable);
      }

      return tables;
    };

    // ========== PORTADA MINIMALISTA ==========

    // Logo
    try {
      const logoImg = new Image();
      logoImg.src = '/assets/Logo.png';
      doc.addImage(logoImg, 'PNG', margin, yPos, 25, 25);
      yPos += 35;
    } catch (e) {
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...colors.black);
      doc.text('OLLAMA WEB', margin, yPos);
      yPos += 15;
    }

    // Título del informe
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...colors.black);
    doc.text('Informe de Investigación', margin, yPos);
    yPos += 15;

    // Query del usuario
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...colors.darkGray);
    const queryLines = doc.splitTextToSize(query, contentWidth);
    queryLines.forEach((line) => {
      doc.text(line, margin, yPos);
      yPos += 6;
    });
    yPos += 5;

    // Fecha y metadatos
    doc.setFontSize(9);
    doc.setTextColor(...colors.mediumGray);
    const dateStr = new Date().toLocaleDateString('es-ES', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    doc.text(dateStr, margin, yPos);
    yPos += 5;
    doc.text(`${findings.length} temas analizados | ${allSources.length} fuentes consultadas`, margin, yPos);
    yPos += 15;

    // Línea separadora
    doc.setDrawColor(...colors.lightGray);
    doc.setLineWidth(0.5);
    doc.line(margin, yPos, pageWidth - margin, yPos);
    yPos += 12;

    // ========== CONTENIDO PRINCIPAL ==========
    // Parsear el contenido de synthesis
    const contentSections = parseContent(synthesis);
    const tables = parseMarkdownTables(synthesis);

    // Renderizar cada sección
    contentSections.forEach((section, sectionIndex) => {
      checkNewPage(30);

      // Si hay título de sección
      if (section.title) {
        doc.setFontSize(13);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...colors.black);
        doc.text(section.title, margin, yPos);
        yPos += 8;
      }

      // Contenido de la sección
      if (section.content) {
        const contentLines = section.content.split('\n');
        let i = 0;

        while (i < contentLines.length) {
          const line = contentLines[i];
          const trimmed = line.trim();

          // Línea vacía - separador
          if (trimmed.length === 0) {
            yPos += 4;
            i++;
            continue;
          }

          // Detectar lista (línea empieza con • o - o *)
          if (trimmed.match(/^[•\-*]\s+/)) {
            // Extraer el contenido sin el bullet
            const itemText = trimmed.replace(/^[•\-*]\s+/, '');

            doc.setFontSize(10);
            doc.setTextColor(...colors.darkGray);

            checkNewPage(8);

            // Dibujar bullet
            doc.setFont('helvetica', 'normal');
            doc.text('•', margin + 2, yPos);

            // Verificar si tiene **negrita**
            if (itemText.includes('**')) {
              // Dividir en partes: normal y negrita
              const parts = [];
              let remaining = itemText;
              let match;
              const boldRegex = /\*\*(.+?)\*\*/g;
              let lastIndex = 0;

              while ((match = boldRegex.exec(itemText)) !== null) {
                if (match.index > lastIndex) {
                  parts.push({ text: itemText.substring(lastIndex, match.index), bold: false });
                }
                parts.push({ text: match[1], bold: true });
                lastIndex = match.index + match[0].length;
              }

              if (lastIndex < itemText.length) {
                parts.push({ text: itemText.substring(lastIndex), bold: false });
              }

              // Renderizar cada parte
              let currentX = margin + 7;
              let currentY = yPos;

              parts.forEach(part => {
                doc.setFont('helvetica', part.bold ? 'bold' : 'normal');

                // Dividir texto en palabras para manejar saltos de línea
                const words = part.text.split(' ');
                words.forEach((word, wordIdx) => {
                  const testText = word + (wordIdx < words.length - 1 ? ' ' : '');
                  const wordWidth = doc.getTextWidth(testText);

                  // Si la palabra no cabe, nueva línea
                  if (currentX + wordWidth > margin + contentWidth) {
                    currentY += 5;
                    currentX = margin + 7;
                    checkNewPage(6);
                  }

                  doc.text(testText, currentX, currentY);
                  currentX += wordWidth;
                });
              });

              yPos = currentY + 5;

            } else {
              // Sin negrita, renderizar normal
              const itemLines = doc.splitTextToSize(itemText, contentWidth - 8);
              itemLines.forEach((itemLine, idx) => {
                if (idx > 0) checkNewPage(6);
                doc.text(itemLine, margin + 7, yPos);
                yPos += 5;
              });
            }

            yPos += 1;
            i++;
            continue;
          }

          // Texto normal (párrafo)
          doc.setFontSize(10);
          doc.setTextColor(...colors.darkGray);

          checkNewPage(8);

          // Verificar si tiene **negrita**
          if (trimmed.includes('**')) {
            // Dividir en partes: normal y negrita
            const parts = [];
            let match;
            const boldRegex = /\*\*(.+?)\*\*/g;
            let lastIndex = 0;

            while ((match = boldRegex.exec(trimmed)) !== null) {
              if (match.index > lastIndex) {
                parts.push({ text: trimmed.substring(lastIndex, match.index), bold: false });
              }
              parts.push({ text: match[1], bold: true });
              lastIndex = match.index + match[0].length;
            }

            if (lastIndex < trimmed.length) {
              parts.push({ text: trimmed.substring(lastIndex), bold: false });
            }

            // Renderizar cada parte
            let currentX = margin;
            let currentY = yPos;

            parts.forEach(part => {
              doc.setFont('helvetica', part.bold ? 'bold' : 'normal');

              // Dividir texto en palabras
              const words = part.text.split(' ');
              words.forEach((word, wordIdx) => {
                const testText = word + (wordIdx < words.length - 1 ? ' ' : '');
                const wordWidth = doc.getTextWidth(testText);

                // Si la palabra no cabe, nueva línea
                if (currentX + wordWidth > margin + contentWidth) {
                  currentY += 5;
                  currentX = margin;
                  checkNewPage(6);
                }

                doc.text(testText, currentX, currentY);
                currentX += wordWidth;
              });
            });

            yPos = currentY + 6;

          } else {
            // Sin negrita, renderizar normal
            doc.setFont('helvetica', 'normal');
            const paraLines = doc.splitTextToSize(trimmed, contentWidth);
            paraLines.forEach(paraLine => {
              checkNewPage(6);
              doc.text(paraLine, margin, yPos);
              yPos += 5;
            });
            yPos += 2;
          }

          i++;
        }
      }

      yPos += 8;
    });

    // ========== TABLAS (si existen) ==========
    if (tables.length > 0) {
      checkNewPage(40);

      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...colors.black);
      doc.text('Datos Comparativos', margin, yPos);
      yPos += 10;

      tables.forEach((table) => {
        if (table.headers.length > 0 && table.rows.length > 0) {
          checkNewPage(50);

          try {
            doc.autoTable({
              startY: yPos,
              head: [table.headers],
              body: table.rows,
              margin: { left: margin, right: margin },
              styles: {
                fontSize: 9,
                cellPadding: 4,
                overflow: 'linebreak',
                halign: 'left',
                textColor: colors.darkGray,
                lineColor: colors.lightGray,
                lineWidth: 0.1
              },
              headStyles: {
                fillColor: colors.darkGray,
                textColor: colors.white,
                fontStyle: 'bold',
                fontSize: 9,
                halign: 'center'
              },
              alternateRowStyles: {
                fillColor: colors.veryLightGray
              }
            });
            yPos = doc.lastAutoTable.finalY + 15;
          } catch (tableError) {
            console.log('Error renderizando tabla:', tableError);
          }
        }
      });
    }

    // ========== DETALLES DE HALLAZGOS ==========
    if (findings.length > 0) {
      checkNewPage(30);

      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...colors.black);
      doc.text('Hallazgos Detallados', margin, yPos);
      yPos += 10;

      findings.forEach((finding, index) => {
        checkNewPage(35);

        // Número del hallazgo
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...colors.mediumGray);
        doc.text(`${index + 1}.`, margin, yPos);

        // Pregunta/tema del hallazgo
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...colors.black);
        const questionLines = doc.splitTextToSize(finding.question, contentWidth - 8);
        questionLines.forEach(line => {
          doc.text(line, margin + 6, yPos);
          yPos += 6;
        });
        yPos += 2;

        // Respuesta del hallazgo
        doc.setFontSize(9);
        doc.setTextColor(...colors.darkGray);

        const answerText = finding.answer || '';
        const answerLines = answerText.split('\n');

        answerLines.forEach(answerLine => {
          const trimmed = answerLine.trim();
          if (trimmed.length === 0) {
            yPos += 3;
            return;
          }

          checkNewPage(8);

          // Detectar lista
          if (trimmed.match(/^[•\-*]\s+/)) {
            const itemText = trimmed.replace(/^[•\-*]\s+/, '');
            doc.setFont('helvetica', 'normal');
            doc.text('•', margin + 8, yPos);

            if (itemText.includes('**')) {
              // Con negritas
              const parts = [];
              let match;
              const boldRegex = /\*\*(.+?)\*\*/g;
              let lastIndex = 0;

              while ((match = boldRegex.exec(itemText)) !== null) {
                if (match.index > lastIndex) {
                  parts.push({ text: itemText.substring(lastIndex, match.index), bold: false });
                }
                parts.push({ text: match[1], bold: true });
                lastIndex = match.index + match[0].length;
              }
              if (lastIndex < itemText.length) {
                parts.push({ text: itemText.substring(lastIndex), bold: false });
              }

              let currentX = margin + 13;
              let currentY = yPos;

              parts.forEach(part => {
                doc.setFont('helvetica', part.bold ? 'bold' : 'normal');
                const words = part.text.split(' ');
                words.forEach((word, wordIdx) => {
                  const testText = word + (wordIdx < words.length - 1 ? ' ' : '');
                  const wordWidth = doc.getTextWidth(testText);
                  if (currentX + wordWidth > margin + contentWidth - 6) {
                    currentY += 4.5;
                    currentX = margin + 13;
                    checkNewPage(6);
                  }
                  doc.text(testText, currentX, currentY);
                  currentX += wordWidth;
                });
              });
              yPos = currentY + 4.5;
            } else {
              // Sin negritas
              doc.setFont('helvetica', 'normal');
              const itemLines = doc.splitTextToSize(itemText, contentWidth - 15);
              itemLines.forEach(itemLine => {
                doc.text(itemLine, margin + 13, yPos);
                yPos += 4.5;
              });
            }
          } else {
            // Párrafo normal
            if (trimmed.includes('**')) {
              // Con negritas
              const parts = [];
              let match;
              const boldRegex = /\*\*(.+?)\*\*/g;
              let lastIndex = 0;

              while ((match = boldRegex.exec(trimmed)) !== null) {
                if (match.index > lastIndex) {
                  parts.push({ text: trimmed.substring(lastIndex, match.index), bold: false });
                }
                parts.push({ text: match[1], bold: true });
                lastIndex = match.index + match[0].length;
              }
              if (lastIndex < trimmed.length) {
                parts.push({ text: trimmed.substring(lastIndex), bold: false });
              }

              let currentX = margin + 6;
              let currentY = yPos;

              parts.forEach(part => {
                doc.setFont('helvetica', part.bold ? 'bold' : 'normal');
                const words = part.text.split(' ');
                words.forEach((word, wordIdx) => {
                  const testText = word + (wordIdx < words.length - 1 ? ' ' : '');
                  const wordWidth = doc.getTextWidth(testText);
                  if (currentX + wordWidth > margin + contentWidth - 6) {
                    currentY += 4.5;
                    currentX = margin + 6;
                    checkNewPage(6);
                  }
                  doc.text(testText, currentX, currentY);
                  currentX += wordWidth;
                });
              });
              yPos = currentY + 5;
            } else {
              // Sin negritas
              doc.setFont('helvetica', 'normal');
              const paraLines = doc.splitTextToSize(trimmed, contentWidth - 6);
              paraLines.forEach(paraLine => {
                doc.text(paraLine, margin + 6, yPos);
                yPos += 4.5;
              });
              yPos += 1;
            }
          }
        });

        // Fuentes del hallazgo
        if (finding.sources && finding.sources.length > 0) {
          yPos += 2;
          doc.setFontSize(8);
          doc.setTextColor(...colors.mediumGray);
          doc.setFont('helvetica', 'italic');
          const sourceDomains = finding.sources.slice(0, 3).map(s => {
            try { return new URL(s.link).hostname.replace('www.', ''); } catch { return ''; }
          }).filter(d => d).join(', ');
          if (sourceDomains) {
            const sourceText = `Fuentes: ${sourceDomains}`;
            doc.text(sourceText, margin + 6, yPos);
            yPos += 5;
          }
        }

        yPos += 8;
      });
    }

    // ========== FUENTES CONSULTADAS ==========
    if (allSources.length > 0) {
      checkNewPage(30);

      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...colors.black);
      doc.text('Fuentes Consultadas', margin, yPos);
      yPos += 10;

      // Eliminar duplicados
      const uniqueSources = [];
      const seenLinks = new Set();
      allSources.forEach(source => {
        if (!seenLinks.has(source.link)) {
          seenLinks.add(source.link);
          uniqueSources.push(source);
        }
      });

      // Listar fuentes de forma limpia
      uniqueSources.slice(0, 30).forEach((source, index) => {
        checkNewPage(10);

        let domain = '';
        try {
          domain = new URL(source.link).hostname.replace('www.', '');
        } catch {
          domain = 'web';
        }

        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...colors.mediumGray);
        doc.text(`[${index + 1}]`, margin, yPos);

        doc.setTextColor(...colors.darkGray);
        const title = (source.title || 'Sin título').substring(0, 70);
        const titleLines = doc.splitTextToSize(title, contentWidth - 10);
        titleLines.forEach((line, idx) => {
          doc.text(line, margin + 8, yPos + (idx * 4));
        });

        const lastLineY = yPos + ((titleLines.length - 1) * 4) + 4;
        doc.setFontSize(7);
        doc.setTextColor(...colors.lightGray);
        doc.text(domain, margin + 8, lastLineY);

        yPos = lastLineY + 5;
      });
    }

    // ========== PIE DE PÁGINA MINIMALISTA EN TODAS LAS PÁGINAS ==========
    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);

      const footerY = pageHeight - 15;

      // Línea superior delgada
      doc.setDrawColor(...colors.lightGray);
      doc.setLineWidth(0.3);
      doc.line(margin, footerY, pageWidth - margin, footerY);

      // Texto del footer
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...colors.mediumGray);

      // Ollama Web a la izquierda
      doc.text('Ollama Web', margin, footerY + 6);

      // Número de página a la derecha
      doc.text(`Página ${i} de ${totalPages}`, pageWidth - margin, footerY + 6, { align: 'right' });
    }

    // ========== GENERAR Y DEVOLVER PDF ==========
    console.log('📦 Generando blob del PDF...');
    const pdfBlob = doc.output('blob');
    console.log('✅ Blob generado:', pdfBlob.size, 'bytes');

    const pdfUrl = URL.createObjectURL(pdfBlob);
    console.log('✅ URL del PDF creada:', pdfUrl);

    webResearchCurrentPdfUrl = pdfUrl;
    return pdfUrl;

  } catch (error) {
    console.error('❌ Error al generar PDF:', error);
    throw error;
  }
}

// Mostrar panel de informe PDF
function showResearchReportPanel(pdfUrl, query, sourcesCount) {
  console.log('📄 Mostrando panel de informe PDF');

  const panel = document.getElementById('research-report-panel');
  const iframe = document.getElementById('research-pdf-viewer');
  const titleText = document.getElementById('research-report-title-text');
  const dateSpan = document.getElementById('research-report-date');
  const sourcesSpan = document.getElementById('research-report-sources-count');

  if (!panel) {
    console.error('❌ No se encontró el elemento research-report-panel');
    return;
  }

  if (!iframe) {
    console.error('❌ No se encontró el elemento research-pdf-viewer');
    return;
  }

  // Si el panel ya está visible con el mismo PDF, no hacer nada
  if (panel.style.display === 'flex' && iframe.src === pdfUrl) {
    console.log('ℹ️ El panel ya está mostrando este PDF');
    return;
  }

  // Actualizar título y metadata
  if (titleText) titleText.textContent = query.length > 40 ? query.substring(0, 40) + '...' : query;
  if (dateSpan) dateSpan.textContent = `${new Date().toLocaleDateString('es-ES')}`;
  if (sourcesSpan) sourcesSpan.textContent = `${sourcesCount} fuentes`;

  // Guardar URL del PDF actual
  webResearchCurrentPdfUrl = pdfUrl;

  // Añadir listener de carga del iframe
  iframe.onload = function () {
    console.log('✅ PDF cargado correctamente en el iframe');
  };

  iframe.onerror = function (error) {
    console.error('❌ Error al cargar el PDF en el iframe:', error);
  };

  // Cargar PDF
  console.log('📥 Cargando PDF en iframe:', pdfUrl);
  iframe.src = pdfUrl;

  // Mostrar panel
  panel.style.display = 'flex';
  document.body.classList.add('research-report-visible');
  console.log('✅ Panel mostrado, clase añadida al body');

  // Remover listeners anteriores para evitar duplicados
  const closeBtn = document.getElementById('close-research-report');
  const downloadBtn = document.getElementById('download-research-pdf');

  if (closeBtn) {
    const newCloseBtn = closeBtn.cloneNode(true);
    closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);
    newCloseBtn.addEventListener('click', closeResearchReportPanel);
    console.log('✅ Botón de cerrar configurado');
  }

  if (downloadBtn) {
    const newDownloadBtn = downloadBtn.cloneNode(true);
    downloadBtn.parentNode.replaceChild(newDownloadBtn, downloadBtn);
    newDownloadBtn.addEventListener('click', downloadResearchPDF);
    console.log('✅ Botón de descarga configurado');
  }
}

// Cerrar panel de informe
function closeResearchReportPanel() {
  const panel = document.getElementById('research-report-panel');
  if (panel) {
    panel.classList.add('closing');
    setTimeout(() => {
      panel.style.display = 'none';
      panel.classList.remove('closing');
      document.body.classList.remove('research-report-visible');
    }, 300);
  }
}

// Descargar PDF
function downloadResearchPDF() {
  if (!webResearchCurrentPdfUrl) return;

  const link = document.createElement('a');
  link.href = webResearchCurrentPdfUrl;
  link.download = `informe-investigacion-${new Date().toISOString().split('T')[0]}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Regenerar y mostrar PDF desde datos guardados (para cuando se cambia de chat)
window.regenerateAndShowPDF = function (messageId) {
  console.log('🔄 Regenerando PDF para mensaje:', messageId);

  // Buscar el mensaje en la conversación actual
  const conversation = state.conversations[state.activeId];
  if (!conversation) {
    console.error('No se encontró la conversación activa');
    return;
  }

  const message = conversation.messages.find(m => m.id === messageId);
  if (!message) {
    console.error('No se encontró el mensaje con ID:', messageId);
    return;
  }

  if (!message.webResearchData) {
    console.error('El mensaje no tiene datos de investigación:', message);
    return;
  }

  const data = message.webResearchData;
  console.log('📊 Datos de investigación encontrados:', {
    query: data.query,
    findings: data.findings?.length || 0,
    sources: data.sources?.length || 0
  });

  try {
    // Generar el PDF
    const pdfUrl = generateResearchPDF(data.query, data.findings, data.synthesisContent, data.sources);
    console.log('✅ PDF generado correctamente:', pdfUrl);

    // Mostrar el panel
    showResearchReportPanel(pdfUrl, data.query, data.sources.length);
  } catch (error) {
    console.error('❌ Error al regenerar el PDF:', error);
    alert('Error al generar el PDF: ' + error.message);
  }
};

// Función principal de investigación web con generación de PDF
async function executeWebResearchWithPDF(userQuery, conversation) {
  console.log('🔬🌐 Iniciando Investigación Web Profunda:', userQuery);

  // Resetear fuentes
  webResearchAllSources = [];

  // Configurar control de cancelación
  deepResearchAbortController = new AbortController();
  deepResearchActiveConversationId = conversation.id;
  deepResearchStartTime = Date.now();
  deepResearchStepTimes = [];
  deepResearchStepsData = [];
  deepResearchFindingsData = [];
  const signal = deepResearchAbortController.signal;

  // Bloquear inputs
  lockInputsDuringResearch();

  const checkCancelled = () => {
    if (signal.aborted) {
      throw new DOMException('Investigación web cancelada', 'AbortError');
    }
  };

  // Crear mensaje del usuario con badge de investigación web
  const userMessage = createMessage('user', userQuery);
  userMessage.isWebResearch = true; // Marcar como investigación web
  conversation.messages.push(userMessage);
  touchConversation(conversation.id);

  showChatState();
  appendMessageElement(userMessage);
  updateConversationTitleFromContent(conversation);

  // Crear mensaje del asistente con progreso
  const assistantMessage = createMessage('assistant', '');
  assistantMessage.isDeepResearchInProgress = true;
  assistantMessage.model = state.currentModel; // Guardar el modelo usado
  conversation.messages.push(assistantMessage);

  deepResearchMessageId = assistantMessage.id;
  const { bubble } = appendMessageElement(assistantMessage);

  // Crear contenedor de progreso
  const progressContainer = createDeepResearchProgressElement();
  bubble.innerHTML = '';
  bubble.appendChild(progressContainer);

  deepResearchCurrentContainer = progressContainer;

  const findings = [];

  try {
    checkCancelled();

    // Fase 1: Generar plan de investigación
    updateDeepResearchProgress(progressContainer, 5, '📋 Generando plan de investigación...');
    const plan = await generateResearchPlan(userQuery, signal);

    checkCancelled();

    // Mostrar pasos del plan
    updateDeepResearchProgress(progressContainer, 10, `🎯 Investigando: ${plan.mainQuestion}`);

    plan.subQuestions.forEach((q, i) => {
      addResearchStep(progressContainer, {
        id: q.id,
        number: i + 1,
        title: q.question,
        description: `🌐 Buscará en la web`
      }, i === 0, false);
    });

    // Fase 2: Investigar cada sub-pregunta CON BÚSQUEDA WEB
    const totalSteps = plan.subQuestions.length;

    for (let i = 0; i < plan.subQuestions.length; i++) {
      checkCancelled();

      const subQ = plan.subQuestions[i];
      const stepStartTime = Date.now();

      updateResearchStep(progressContainer, subQ.id, { isActive: true });
      const currentProgress = 10 + ((i + 1) / totalSteps) * 60;

      // Contador de fuentes para animación
      let sourceIndex = 0;
      let thinkingCycle = 0;

      // Callback de progreso para mostrar estado de búsqueda, fuentes y pensamiento
      const progressCallback = (status, data) => {
        updateDeepResearchProgress(progressContainer, currentProgress, status);

        // Si hay fuentes nuevas, añadirlas al grid visual
        if (data && data.sources) {
          data.sources.forEach(source => {
            addWebSourceToGrid(progressContainer, source, sourceIndex++);
          });
          scrollChatToBottom();
        }

        // Si hay pensamiento de la IA, añadirlo al panel
        if (data && data.thinking) {
          thinkingCycle++;
          addAIThinking(progressContainer, thinkingCycle, data.thinking);
          scrollChatToBottom();
        }
      };

      progressCallback(`🌐 Investigando con web: ${subQ.question.substring(0, 40)}...`);

      // Investigar CON BÚSQUEDA WEB ITERATIVA
      const result = await investigateSubQuestionWithWeb(
        subQ.question,
        findings.map(f => f.keyPoints).flat(),
        signal,
        progressCallback
      );

      // Registrar tiempo
      deepResearchStepTimes.push(Date.now() - stepStartTime);

      checkCancelled();

      findings.push(result);

      // Acumular fuentes
      if (result.sources) {
        webResearchAllSources.push(...result.sources);
      }

      // Mostrar hallazgos clave
      result.keyPoints.slice(0, 2).forEach(point => {
        addFinding(progressContainer, point);
      });

      updateResearchStep(progressContainer, subQ.id, {
        isActive: false,
        isCompleted: true,
        description: `✅ ${result.sources?.length || 0} fuentes consultadas`
      });

      scrollChatToBottom();
    }

    // Fase 3: Sintetizar hallazgos
    updateDeepResearchProgress(progressContainer, 85, '📝 Sintetizando hallazgos...');
    checkCancelled();

    const finalReport = await synthesizeFindings(userQuery, findings, signal);

    // Fase 4: Generar PDF
    updateDeepResearchProgress(progressContainer, 95, '📄 Generando informe PDF...');
    checkCancelled();

    const pdfUrl = await generateResearchPDF(userQuery, findings, finalReport, webResearchAllSources);

    // Completar
    updateDeepResearchProgress(progressContainer, 100, '✅ ¡Investigación completada!');

    // Guardar resultado con datos para regenerar PDF
    assistantMessage.content = finalReport;
    assistantMessage.isDeepResearchInProgress = false;
    assistantMessage.webResearchData = {
      query: userQuery,
      findings: findings,
      sources: webResearchAllSources,
      pdfGenerated: true,
      synthesisContent: finalReport
    };
    persistState();

    // Renderizar informe final
    setTimeout(() => {
      // Quitar flag de progreso
      assistantMessage.isDeepResearchInProgress = false;

      bubble.innerHTML = `
        <div class="deep-research-report">
          <div class="deep-research-report-header">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>
            Investigación web profunda • ${findings.length} temas • ${webResearchAllSources.length} fuentes
          </div>
        </div>
        ${parseMarkdown(finalReport)}
        <button class="generate-report-btn" onclick="event.stopPropagation(); regenerateAndShowPDF('${assistantMessage.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
          Ver informe PDF completo
        </button>
      `;

      // Abrir panel de PDF automáticamente
      showResearchReportPanel(pdfUrl, userQuery, webResearchAllSources.length);

      // Añadir botón de copiar
      const copyContainer = document.createElement('div');
      copyContainer.className = 'copy-message-container';

      const copyButton = document.createElement('button');
      copyButton.className = 'copy-message-btn';
      copyButton.title = 'Copiar informe';
      copyButton.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
      copyButton.addEventListener('click', async () => {
        await copyToClipboard(finalReport, copyButton);
      });

      copyContainer.appendChild(copyButton);
      
      // Añadir indicador de modelo si existe
      if (assistantMessage.model) {
        const modelIndicator = document.createElement('span');
        modelIndicator.className = 'message-model-indicator';
        
        // Mostrar modelo y tokens/segundo si está disponible
        let displayText = assistantMessage.model;
        if (assistantMessage.tokensPerSecond && assistantMessage.tokensPerSecond > 0) {
          displayText += ` • ${assistantMessage.tokensPerSecond} t/s`;
        }
        
        modelIndicator.textContent = displayText;
        modelIndicator.title = `Respondido por ${assistantMessage.model}${assistantMessage.tokensPerSecond ? ` (${assistantMessage.tokensPerSecond} tokens/segundo)` : ''}`;
        copyContainer.appendChild(modelIndicator);
      }
      
      const timeElement = document.createElement('span');
      timeElement.className = 'message-time';
      timeElement.textContent = formatTime(Date.now());

      copyContainer.appendChild(timeElement);
      bubble.appendChild(copyContainer);

      // Renderizar matemáticas
      if (typeof renderMathInElement !== 'undefined') {
        renderMathInElement(bubble, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$', right: '$', display: false }
          ],
          throwOnError: false
        });
      }

      renderConversationList();
      scrollChatToBottom();
    }, 1000);

  } catch (error) {
    assistantMessage.isDeepResearchInProgress = false;

    if (error.name === 'AbortError') {
      console.log('🛑 Investigación web cancelada');
      assistantMessage.content = `⚠️ Investigación cancelada`;
      if (bubble && document.body.contains(bubble)) {
        bubble.innerHTML = parseMarkdown(assistantMessage.content);
      }
    } else {
      console.error('Error en investigación web:', error);
      assistantMessage.content = `⚠️ Error durante la investigación: ${error.message}`;
      if (bubble && document.body.contains(bubble)) {
        bubble.innerHTML = parseMarkdown(assistantMessage.content);
      }
    }
    persistState();
  } finally {
    // Limpiar estado
    deepResearchAbortController = null;
    deepResearchActiveConversationId = null;
    deepResearchStartTime = null;
    deepResearchStepTimes = [];
    deepResearchProgressState = null;
    deepResearchMessageId = null;
    deepResearchCurrentContainer = null;
    deepResearchStepsData = [];
    deepResearchFindingsData = [];
    unlockInputsDuringResearch();

    document.querySelectorAll('.research-indicator').forEach(el => el.remove());
    const banner = document.getElementById('research-progress-banner');
    if (banner) banner.remove();
  }

  // Desactivar modo después de completar
  if (deepResearchMode) {
    toggleDeepResearch();
  }

  return findings;
}

// Hacer funciones globales para el onclick
window.showResearchReportPanel = showResearchReportPanel;
window.closeResearchReportPanel = closeResearchReportPanel;
window.downloadResearchPDF = downloadResearchPDF;

async function handleSubmitWithDeepResearch(event) {
  event.preventDefault();
  if (state.loading) return;

  // Si Deep Research está activo, usar ese flujo
  if (deepResearchMode) {
    const isEmptyState = emptyState?.style.display !== 'none';
    const activeInput = isEmptyState ? promptInput : promptInputInline;
    const prompt = activeInput?.value.trim();

    if (!prompt) return;

    const conversation = state.conversations[state.activeId];
    if (!conversation) return;

    state.loading = true;
    activeInput.value = '';
    autoResizeTextarea(activeInput);

    try {
      await executeWebResearchWithPDF(prompt, conversation);
    } catch (error) {
      console.error('Error en Deep Research:', error);
    } finally {
      state.loading = false;
    }

    return;
  }

  // Si el modo canvas está activo, usar el flujo normal con canvas
  if (canvasMode) {
    return originalHandleSubmit.call(this, event);
  }

  // Si el modo web está activo, buscar en internet primero con UI visual
  if (webSearchMode) {
    const isEmptyState = emptyState?.style.display !== 'none';
    const activeInput = isEmptyState ? promptInput : promptInputInline;
    const prompt = activeInput?.value.trim();

    if (!prompt) return;

    const conversation = state.conversations[state.activeId];
    if (!conversation) return;

    // Limpiar input
    activeInput.value = '';
    autoResizeTextarea(activeInput);

    // Mostrar el chat si estamos en empty state
    if (isEmptyState) {
      showChatState();
    }

    // Crear mensaje del usuario
    const userMessage = createMessage('user', prompt);
    conversation.messages.push(userMessage);
    touchConversation(conversation.id);
    appendMessageElement(userMessage);
    updateConversationTitleFromContent(conversation);
    conversation.updatedAt = Date.now();
    persistState();
    renderConversationList();

    // Crear UI de búsqueda web
    const webSearchUI = createWebSearchUI(prompt);

    // Crear mensaje del asistente con la UI de búsqueda
    const assistantMessage = createMessage('assistant', '');
    assistantMessage.model = state.currentModel; // Guardar el modelo usado
    conversation.messages.push(assistantMessage);
    const { bubble } = appendMessageElement(assistantMessage);

    // Insertar la UI de búsqueda en el bubble
    bubble.innerHTML = '';
    bubble.appendChild(webSearchUI);

    // Scroll hacia abajo
    const chatArea = document.querySelector('.chat-area');
    if (chatArea) chatArea.scrollTop = chatArea.scrollHeight;

    console.log('🌐 Buscando en la web:', prompt);

    try {
      // Determinar tipo de búsqueda (web general o papers académicos)
      const searchType = window._webSearchType || 'general';
      let searchResults;
      
      if (searchType === 'academic') {
        console.log('🔬 Modo búsqueda académica activado');
        searchResults = await searchAcademicPapers(prompt);
      } else {
        console.log('🌐 Modo búsqueda web general activado');
        searchResults = await searchWeb(prompt);
      }

      if (searchResults) {
        // Actualizar la UI con los resultados
        updateWebSearchUI(webSearchUI, searchResults, prompt);

        const formattedResults = formatSearchResults(searchResults);
        window._webSearchContext = formattedResults;
        window._webSearchQuery = prompt;
        window._webSearchResults = searchResults;
        console.log('🌐 Resultados encontrados:', searchResults);

        // Pequeña pausa para que se vea la animación
        await new Promise(resolve => setTimeout(resolve, 500));

        // Ahora generar la respuesta del modelo
        // Añadir un separador visual
        const separator = document.createElement('div');
        separator.style.cssText = 'height: 1px; background: rgba(255,255,255,0.1); margin: 16px 0;';
        bubble.appendChild(separator);

        // Crear contenedor para la respuesta
        const responseContainer = document.createElement('div');
        responseContainer.className = 'web-search-response';
        bubble.appendChild(responseContainer);

        // Guardar referencia para la respuesta streaming
        window._webSearchResponseContainer = responseContainer;
        window._webSearchModeActive = true;

        // Construir mensajes para el modelo
        const payloadMessages = buildWebSearchPayload(conversation, prompt, formattedResults);

        state.loading = true;

        try {
          // Pasar los resultados de búsqueda para el botón de fuentes
          await streamAssistantResponseInContainer(conversation, payloadMessages, responseContainer, assistantMessage, searchResults);
        } catch (error) {
          console.error('Error generando respuesta:', error);
          responseContainer.innerHTML = `<p style="color: #ef4444;">⚠️ Error al generar respuesta: ${error.message}</p>`;
        } finally {
          state.loading = false;
          window._webSearchModeActive = false;
          window._webSearchContext = null;
          window._webSearchResponseContainer = null;
        }

      } else {
        // Error en la búsqueda
        webSearchUI.innerHTML = `
          <div style="color: #ef4444; padding: 12px;">
            ⚠️ No se pudieron obtener resultados de búsqueda. Intenta de nuevo.
          </div>
        `;
        window._webSearchContext = null;
        window._webSearchQuery = null;
      }
    } catch (error) {
      console.error('Error en búsqueda web:', error);
      webSearchUI.innerHTML = `
        <div style="color: #ef4444; padding: 12px;">
          ⚠️ Error en la búsqueda: ${error.message}
        </div>
      `;
      window._webSearchContext = null;
      window._webSearchQuery = null;
    }

    persistState();
    return;
  }

  // Reset web search state
  window._webSearchModeActive = false;
  window._webSearchContext = null;

  // Si el modo estudio está activo, añadir el prompt de sistema
  if (studyMode) {
    window._studyModeActive = true;
  } else {
    window._studyModeActive = false;
  }

  // Si el modo salud está activo, activar flag
  if (state.chatMode === 'health') {
    window._healthModeActive = true;
  } else {
    window._healthModeActive = false;
  }

  // Si no, usar el flujo normal
  return originalHandleSubmit.call(this, event);
}

// Construir payload para búsqueda web
function buildWebSearchPayload(conversation, prompt, webContext) {
  const payloadMessages = [];

  // Detectar si es búsqueda académica
  const isAcademic = webContext.includes('📚 **PAPERS ACADÉMICOS');
  
  // Mensaje de sistema con contexto web - INSTRUCCIONES ADAPTADAS
  let systemMessage;
  
  if (isAcademic) {
    systemMessage = `🔬 MODO BÚSQUEDA ACADÉMICA - PAPERS CIENTÍFICOS

He realizado una búsqueda en bases de datos académicas (OpenAlex) sobre la consulta del usuario. A continuación están los papers encontrados:

${webContext}

⚠️ INSTRUCCIONES PARA CONTENIDO ACADÉMICO:

1. **CITACIÓN ACADÉMICA OBLIGATORIA**: Cada afirmación científica DEBE incluir una cita [id] inmediatamente después.
   ✅ Correcto: "Los transformers revolucionaron el NLP [1]. BERT utiliza atención bidireccional [2]."
   ❌ Incorrecto: "Los transformers revolucionaron el NLP. BERT utiliza atención bidireccional."

2. **FORMATO ESTRICTO**: Usa SOLO el formato [número] (ej: [1], [2], [3]).
   - Las citas van DENTRO del texto, no al final.
   - Si múltiples papers respaldan un dato, usa [1][2].

3. **RIGOR CIENTÍFICO**: 
   - Menciona autores cuando sea relevante: "Según Smith et al. [1]..."
   - Indica el año de publicación cuando contextualice: "En 2020, se demostró que... [2]"
   - Señala el número de citas para destacar impacto: "Este estudio altamente citado [3] demuestra..."

4. **SOLO USA LOS PAPERS PROPORCIONADOS**: 
   - NO inventes citas o referencias a papers no listados.
   - Si no hay suficiente información, indica: "Los papers encontrados no cubren este aspecto específico."

5. **SÍNTESIS ACADÉMICA**: 
   - Compara hallazgos entre diferentes papers cuando sea apropiado.
   - Señala consensos: "Múltiples estudios coinciden en que... [1][2][3]"
   - Indica divergencias: "Mientras [1] sugiere X, [2] propone Y"

6. **RESPUESTA EN ESPAÑOL**: Académica, rigurosa y clara.

🎯 RECORDATORIO: Cada afirmación científica = una cita [id]. Rigor académico absoluto.`;
  } else {
    systemMessage = `🌐 MODO BÚSQUEDA WEB CON CITACIÓN ACADÉMICA

He realizado una búsqueda en internet sobre la consulta del usuario. A continuación están las fuentes encontradas:

${webContext}

⚠️ INSTRUCCIONES CRÍTICAS DE CITACIÓN:

1. **CITACIÓN OBLIGATORIA**: Cada afirmación factual DEBE incluir una cita [id] inmediatamente después de la oración.
   ✅ Correcto: "El grafeno es un superconductor [1]. Fue descubierto en 2004 [2]."
   ❌ Incorrecto: "El grafeno es un superconductor. Fue descubierto en 2004."

2. **FORMATO ESTRICTO**: Usa SOLO el formato [número] (ej: [1], [2], [3]).
   - NO uses [Fuente 1], [ref1], ni otros formatos.
   - Las citas van DENTRO del párrafo, no al final.

3. **MÚLTIPLES FUENTES**: Si varias fuentes respaldan un hecho, usa [1][2].

4. **SOLO USA LAS FUENTES PROPORCIONADAS**: 
   - NO inventes citas ([6], [7] si solo hay 5 fuentes).
   - Si no hay información en las fuentes, responde: "No encontré información sobre esto en las fuentes disponibles."

5. **SIN CONOCIMIENTO EXTERNO**: Basa tu respuesta ÚNICAMENTE en el contexto web proporcionado.

6. **RESPUESTA EN ESPAÑOL**: Clara, concisa y profesional.

🎯 RECORDATORIO: Cada dato = una cita [id]. Sin excepciones.`;
  }

  payloadMessages.push({
    role: 'system',
    content: systemMessage
  });

  // Añadir historial de conversación (últimos mensajes relevantes)
  const recentMessages = conversation.messages.slice(-6, -1); // Excluir el último que es el actual
  recentMessages.forEach(msg => {
    if (msg.role === 'user' || msg.role === 'assistant') {
      payloadMessages.push({
        role: msg.role,
        content: msg.content || ''
      });
    }
  });

  // Añadir el mensaje actual del usuario
  payloadMessages.push({
    role: 'user',
    content: prompt
  });

  return payloadMessages;
}

// Crear bloque de razonamiento para modo web (streaming en vivo)
function createWebThinkingBlock(thinking, isLoading = true) {
  if (isLoading) {
    return `
      <div class="web-thinking-block expanded">
        <div class="web-thinking-block-header">
          <svg class="web-thinking-block-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
          <span class="web-thinking-block-title">Analizando fuentes<span class="web-thinking-dots"><span>.</span><span>.</span><span>.</span></span></span>
        </div>
        <div class="web-thinking-block-content">
          <div class="web-thinking-block-text">${escapeHtml(thinking || '')}<span class="web-thinking-cursor">▊</span></div>
        </div>
      </div>
    `;
  }

  // Bloque colapsado después de terminar
  return `
    <div class="web-thinking-block collapsed" onclick="this.classList.toggle('expanded'); this.classList.toggle('collapsed');">
      <div class="web-thinking-block-header">
        <svg class="web-thinking-block-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
        </svg>
        <span class="web-thinking-block-title">Análisis web completado</span>
        <span class="web-thinking-block-chevron">▼</span>
      </div>
      <div class="web-thinking-block-content">
        <div class="web-thinking-block-text">${escapeHtml(thinking || '')}</div>
      </div>
    </div>
  `;
}

// Stream respuesta en un contenedor específico
async function streamAssistantResponseInContainer(conversation, payloadMessages, container, assistantMessage, searchResults = null) {
  if (!state.currentModel) {
    throw new Error('Selecciona un modelo antes de enviar un mensaje.');
  }

  // Mostrar bloque de razonamiento inicial
  container.innerHTML = createWebThinkingBlock('', true);

  const body = {
    model: state.currentModel,
    stream: true,
    messages: payloadMessages,
    options: {
      num_ctx: 8192
    }
  };

  console.log('🌐 Enviando solicitud al modelo:', state.currentModel);

  const startTime = Date.now(); // Capturar tiempo de inicio

  const response = await fetch(`${API_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Error del servidor:', response.status, errorText);
    throw new Error(`Error del servidor: ${response.statusText}`);
  }

  const reader = response.body.getReader();
  currentStreamReader = reader;
  updateSendButtonToStop();

  let fullContent = '';
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (wasCancelled) {
        wasCancelled = false;
        break;
      }

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter(line => line.trim());

      for (const line of lines) {
        try {
          const json = JSON.parse(line);
          if (json.message?.content) {
            fullContent += json.message.content;

            // Actualizar el bloque de razonamiento en vivo
            const thinkingTextEl = container.querySelector('.web-thinking-block-text');
            if (thinkingTextEl) {
              thinkingTextEl.innerHTML = escapeHtml(fullContent) + '<span class="web-thinking-cursor">▊</span>';

              // Auto-scroll dentro del bloque de pensamiento
              const contentEl = container.querySelector('.web-thinking-block-content');
              if (contentEl) {
                contentEl.scrollTop = contentEl.scrollHeight;
              }
            }

            // Scroll del chat
            const chatArea = document.querySelector('.chat-area');
            if (chatArea) chatArea.scrollTop = chatArea.scrollHeight;
          }
        } catch (e) {
          // Ignorar errores de parsing JSON
        }
      }
    }
  } catch (error) {
    console.error('Error durante el streaming:', error);
    throw error;
  } finally {
    currentStreamReader = null;
    updateStopButtonToSend();
  }

  // Cuando termina: mostrar bloque colapsado + respuesta formateada
  if (fullContent) {
    let html = createWebThinkingBlock(fullContent, false);
    html += '<div class="web-response-content">' + parseMarkdown(fullContent) + '</div>';
    container.innerHTML = html;

    const responseEl = container.querySelector('.web-response-content');
    if (responseEl && typeof renderMathInElement !== 'undefined') {
      renderMathInElement(responseEl, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false }
        ],
        throwOnError: false
      });
    }
  }

  // Actualizar el mensaje en la conversación
  assistantMessage.content = fullContent;

  // Calcular tokens por segundo
  const responseTime = (Date.now() - startTime) / 1000;
  const estimatedTokens = Math.ceil(fullContent.length / 3.5);
  assistantMessage.tokensPerSecond = responseTime > 0 ? Math.round(estimatedTokens / responseTime) : 0;

  // Guardar datos de búsqueda web en el mensaje para persistencia
  if (searchResults && searchResults.organic) {
    assistantMessage.webSearchData = {
      query: window._webSearchQuery || '',
      results: searchResults.organic.slice(0, 5).map(r => ({
        title: r.title,
        link: r.link,
        snippet: r.snippet || ''
      }))
    };
  }

  // Añadir botones de copiar, regenerar y fuentes (si es búsqueda web)
  const copyContainer = document.createElement('div');
  copyContainer.className = 'copy-message-container';

  const regenerateBtn = document.createElement('button');
  regenerateBtn.className = 'regenerate-message-btn';
  regenerateBtn.title = 'Regenerar respuesta';
  regenerateBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4v6h6"></path><path d="M23 20v-6h-6"></path><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"></path></svg>';

  const copyBtn = document.createElement('button');
  copyBtn.className = 'copy-message-btn';
  copyBtn.title = 'Copiar mensaje';
  copyBtn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
    </svg>
  `;
  copyBtn.onclick = () => copyToClipboard(fullContent, copyBtn);

  copyContainer.appendChild(regenerateBtn);
  copyContainer.appendChild(copyBtn);

  // Añadir botón de fuentes solo si hay resultados de búsqueda web
  if (searchResults && searchResults.organic && searchResults.organic.length > 0) {
    const sourcesBtn = document.createElement('button');
    sourcesBtn.className = 'web-sources-btn';
    sourcesBtn.title = 'Ver fuentes consultadas';
    sourcesBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
      </svg>
      <span>${searchResults.organic.length}</span>
    `;

    // Crear el popup de fuentes
    const sourcesPopup = document.createElement('div');
    sourcesPopup.className = 'web-sources-popup';
    sourcesPopup.style.display = 'none';

    let popupContent = '<div class="web-sources-popup-header"><span>Fuentes consultadas</span></div>';
    popupContent += '<div class="web-sources-popup-list">';

    searchResults.organic.slice(0, 5).forEach(result => {
      let domain = '';
      let faviconUrl = '';
      try {
        const urlObj = new URL(result.link);
        domain = urlObj.hostname.replace('www.', '');
        faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
      } catch (e) {
        domain = 'web';
      }

      popupContent += `
        <a href="${result.link}" target="_blank" rel="noopener noreferrer" class="web-sources-popup-item">
          <img src="${faviconUrl}" alt="" class="web-sources-popup-favicon" onerror="this.style.display='none'">
          <div class="web-sources-popup-info">
            <div class="web-sources-popup-title">${escapeHtml(result.title)}</div>
            <div class="web-sources-popup-url">${domain}</div>
          </div>
        </a>
      `;
    });

    popupContent += '</div>';
    sourcesPopup.innerHTML = popupContent;

    // Toggle del popup
    sourcesBtn.onclick = (e) => {
      e.stopPropagation();
      const isVisible = sourcesPopup.style.display === 'block';
      sourcesPopup.style.display = isVisible ? 'none' : 'block';
    };

    // Cerrar popup al hacer clic fuera
    document.addEventListener('click', (e) => {
      if (!sourcesBtn.contains(e.target) && !sourcesPopup.contains(e.target)) {
        sourcesPopup.style.display = 'none';
      }
    });

    copyContainer.appendChild(sourcesBtn);
    copyContainer.appendChild(sourcesPopup);
  }

  // Añadir indicador de modelo si existe
  if (assistantMessage && assistantMessage.model) {
    const modelIndicator = document.createElement('span');
    modelIndicator.className = 'message-model-indicator';
    
    // Mostrar modelo y tokens/segundo si está disponible
    let displayText = assistantMessage.model;
    if (assistantMessage.tokensPerSecond && assistantMessage.tokensPerSecond > 0) {
      displayText += ` • ${assistantMessage.tokensPerSecond} t/s`;
    }
    
    modelIndicator.textContent = displayText;
    modelIndicator.title = `Respondido por ${assistantMessage.model}${assistantMessage.tokensPerSecond ? ` (${assistantMessage.tokensPerSecond} tokens/segundo)` : ''}`;
    copyContainer.appendChild(modelIndicator);
  }

  const timeSpan = document.createElement('span');
  timeSpan.className = 'message-time';
  timeSpan.textContent = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

  copyContainer.appendChild(timeSpan);
  container.appendChild(copyContainer);

  persistState();
  console.log('🌐 Respuesta completada');
}

// Sobrescribir handleSubmit globalmente
handleSubmit = handleSubmitWithDeepResearch;

// ========================================
// Screen Overlay Mode - Chat con Captura de Pantalla
// ========================================

let screenOverlayActive = false;
let screenOverlayStream = null;
let screenOverlayCapture = null; // Base64 de la captura actual
let screenOverlayMessages = [];
let screenOverlayDragging = false;
let screenOverlayDragOffset = { x: 0, y: 0 };

// Elementos del overlay
const screenOverlayContainer = document.getElementById('screen-overlay-container');
const screenOverlayPanel = document.querySelector('.screen-overlay-panel');
const screenOverlayMessagesContainer = document.getElementById('screen-overlay-messages');
const screenOverlayInput = document.getElementById('screen-overlay-input');
const screenOverlaySendBtn = document.getElementById('screen-overlay-send');
const screenOverlayModelSelect = document.getElementById('screen-overlay-model-select');
const screenOverlayPreview = document.getElementById('screen-overlay-preview');
const screenOverlayPreviewImg = document.getElementById('screen-overlay-preview-img');
const screenOverlayMinimized = document.getElementById('screen-overlay-minimized');

// Botones
const screenOverlayToggle = document.getElementById('screen-overlay-toggle');
const screenOverlayToggleEmpty = document.getElementById('screen-overlay-toggle-empty');
const screenOverlayCaptureBtn = document.getElementById('screen-overlay-capture');
const screenOverlayMinimizeBtn = document.getElementById('screen-overlay-minimize');
const screenOverlayCloseBtn = document.getElementById('screen-overlay-close');
const screenOverlayRestoreBtn = document.getElementById('screen-overlay-restore');
const screenOverlayClearCaptureBtn = document.getElementById('screen-overlay-clear-capture');
const screenOverlayPopoutBtn = document.getElementById('screen-overlay-popout');

// Variable para la ventana popup
let screenOverlayPopupWindow = null;

// Inicializar Screen Overlay
function initScreenOverlay() {
  // Toggle buttons
  screenOverlayToggle?.addEventListener('click', toggleScreenOverlay);
  screenOverlayToggleEmpty?.addEventListener('click', toggleScreenOverlay);

  // Panel buttons
  screenOverlayCaptureBtn?.addEventListener('click', captureScreen);
  screenOverlayMinimizeBtn?.addEventListener('click', minimizeScreenOverlay);
  screenOverlayCloseBtn?.addEventListener('click', closeScreenOverlay);
  screenOverlayRestoreBtn?.addEventListener('click', restoreScreenOverlay);
  screenOverlayClearCaptureBtn?.addEventListener('click', clearScreenCapture);
  screenOverlayPopoutBtn?.addEventListener('click', popoutScreenOverlay);

  // Send button
  screenOverlaySendBtn?.addEventListener('click', sendScreenOverlayMessage);

  // Input handling
  screenOverlayInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendScreenOverlayMessage();
    }
  });

  screenOverlayInput?.addEventListener('input', () => {
    autoResizeOverlayTextarea();
  });

  // Dragging functionality
  const header = document.querySelector('.screen-overlay-header');
  if (header && screenOverlayPanel) {
    header.addEventListener('mousedown', startDragging);
    document.addEventListener('mousemove', handleDragging);
    document.addEventListener('mouseup', stopDragging);
  }

  // Keyboard shortcut for capture
  document.addEventListener('keydown', (e) => {
    // Ctrl+Shift+S para capturar cuando el overlay está activo
    if (e.ctrlKey && e.shiftKey && e.key === 'S' && screenOverlayActive) {
      e.preventDefault();
      captureScreen();
    }
    // Escape para cerrar el overlay
    if (e.key === 'Escape' && screenOverlayActive) {
      closeScreenOverlay();
    }
  });

  // Sync models
  syncOverlayModels();
}

// Sincronizar modelos con el selector principal
function syncOverlayModels() {
  if (!screenOverlayModelSelect || !modelSelect) return;

  // Copiar opciones del selector principal
  screenOverlayModelSelect.innerHTML = modelSelect.innerHTML;
  screenOverlayModelSelect.value = modelSelect.value;

  // Mantener sincronizado
  screenOverlayModelSelect.addEventListener('change', (e) => {
    state.currentModel = e.target.value;
    modelSelect.value = e.target.value;
    if (modelSelectInline) modelSelectInline.value = e.target.value;
    persistState();
  });
}

// Toggle Screen Overlay Mode
function toggleScreenOverlay() {
  if (screenOverlayActive) {
    closeScreenOverlay();
  } else {
    openScreenOverlay();
  }
}

// Abrir Screen Overlay
async function openScreenOverlay() {
  screenOverlayActive = true;

  // Sincronizar modelos antes de mostrar
  syncOverlayModels();

  // Mostrar el overlay
  if (screenOverlayContainer) {
    screenOverlayContainer.style.display = 'block';
  }
  if (screenOverlayPanel) {
    screenOverlayPanel.style.display = 'flex';
  }
  if (screenOverlayMinimized) {
    screenOverlayMinimized.style.display = 'none';
  }

  // Actualizar botones
  [screenOverlayToggle, screenOverlayToggleEmpty].forEach(btn => {
    if (btn) btn.classList.add('active');
  });

  // Limpiar mensajes anteriores
  screenOverlayMessages = [];
  renderOverlayMessages();

  // Enfocar input
  setTimeout(() => {
    screenOverlayInput?.focus();
  }, 100);

  // Mostrar notificación de instrucciones
  showScreenCaptureNotification('Modo Overlay activado - Captura tu pantalla para empezar');
}

// Cerrar Screen Overlay
function closeScreenOverlay() {
  screenOverlayActive = false;

  // Detener cualquier stream de pantalla
  if (screenOverlayStream) {
    screenOverlayStream.getTracks().forEach(track => track.stop());
    screenOverlayStream = null;
  }

  // Ocultar overlay
  if (screenOverlayContainer) {
    screenOverlayContainer.style.display = 'none';
  }

  // Limpiar captura
  clearScreenCapture();

  // Actualizar botones
  [screenOverlayToggle, screenOverlayToggleEmpty].forEach(btn => {
    if (btn) btn.classList.remove('active');
  });
}

// Abrir el overlay en una ventana popup independiente
function popoutScreenOverlay() {
  // Si ya hay una ventana popup abierta, darle foco
  if (screenOverlayPopupWindow && !screenOverlayPopupWindow.closed) {
    screenOverlayPopupWindow.focus();
    return;
  }

  // Calcular tamaño y posición de la ventana
  const width = 400;
  const height = 550;
  const left = window.screen.width - width - 50;
  const top = 100;

  // Características de la ventana
  const features = [
    `width=${width}`,
    `height=${height}`,
    `left=${left}`,
    `top=${top}`,
    'resizable=yes',
    'scrollbars=no',
    'status=no',
    'menubar=no',
    'toolbar=no',
    'location=no'
  ].join(',');

  // Abrir la ventana popup
  screenOverlayPopupWindow = window.open('overlay-popup.html', 'OllamaOverlay', features);

  if (screenOverlayPopupWindow) {
    // Cerrar el overlay dentro de la app principal
    closeScreenOverlay();

    // Escuchar mensajes de la ventana popup
    window.addEventListener('message', handlePopupMessage);

    // Enviar el modelo actual cuando la ventana esté lista
    screenOverlayPopupWindow.addEventListener('load', () => {
      if (state.currentModel) {
        screenOverlayPopupWindow.postMessage({ type: 'setModel', model: state.currentModel }, '*');
      }
    });

    // Monitorear si la ventana se cierra
    const checkPopup = setInterval(() => {
      if (screenOverlayPopupWindow && screenOverlayPopupWindow.closed) {
        clearInterval(checkPopup);
        screenOverlayPopupWindow = null;
        window.removeEventListener('message', handlePopupMessage);
      }
    }, 500);

    // Notificación
    showScreenCaptureNotification('Chat abierto en ventana flotante - Siempre visible');
  } else {
    // Si no se pudo abrir (popup bloqueado), mostrar error
    showScreenCaptureNotification('⚠️ Permite ventanas emergentes para esta función');
  }
}

// Manejar mensajes del popup
function handlePopupMessage(event) {
  const data = event.data;

  if (data.type === 'getModel') {
    // El popup solicita el modelo actual
    if (screenOverlayPopupWindow && !screenOverlayPopupWindow.closed && state.currentModel) {
      screenOverlayPopupWindow.postMessage({ type: 'setModel', model: state.currentModel }, '*');
    }
  } else if (data.type === 'modelChange') {
    // El popup cambió el modelo, sincronizar
    if (data.model) {
      state.currentModel = data.model;
      if (modelSelect) modelSelect.value = data.model;
      if (modelSelectInline) modelSelectInline.value = data.model;
      if (screenOverlayModelSelect) screenOverlayModelSelect.value = data.model;
      persistState();
    }
  }
}

// Minimizar overlay
function minimizeScreenOverlay() {
  if (screenOverlayPanel) {
    screenOverlayPanel.style.display = 'none';
  }
  if (screenOverlayMinimized) {
    screenOverlayMinimized.style.display = 'block';
  }
}

// Restaurar overlay
function restoreScreenOverlay() {
  if (screenOverlayPanel) {
    screenOverlayPanel.style.display = 'flex';
  }
  if (screenOverlayMinimized) {
    screenOverlayMinimized.style.display = 'none';
  }

  // Enfocar input
  setTimeout(() => {
    screenOverlayInput?.focus();
  }, 100);
}

// Capturar pantalla
async function captureScreen() {
  try {
    // Añadir clase de animación al botón
    if (screenOverlayCaptureBtn) {
      screenOverlayCaptureBtn.classList.add('capturing');
    }

    // OCULTAR COMPLETAMENTE el panel antes de capturar
    const panelOriginalDisplay = screenOverlayPanel?.style.display;
    const containerOriginalDisplay = screenOverlayContainer?.style.display;

    if (screenOverlayPanel) {
      screenOverlayPanel.style.display = 'none';
    }

    // Pequeña espera para asegurar que el panel esté oculto
    await new Promise(resolve => setTimeout(resolve, 50));

    // Crear un indicador visual de que estamos en modo captura
    const captureIndicator = document.createElement('div');
    captureIndicator.className = 'capture-mode-indicator';
    captureIndicator.innerHTML = `
      <div class="capture-mode-content">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
        <span>Selecciona qué capturar</span>
      </div>
    `;
    document.body.appendChild(captureIndicator);

    try {
      // Solicitar captura de pantalla - el usuario selecciona qué capturar
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'always',
          displaySurface: 'monitor' // Preferir pantalla completa
        },
        audio: false,
        preferCurrentTab: false,
        selfBrowserSurface: 'exclude', // Excluir la pestaña actual si es posible
        systemAudio: 'exclude'
      });

      // Quitar indicador
      captureIndicator.remove();

      // Capturar un frame INSTANTÁNEAMENTE
      const track = stream.getVideoTracks()[0];
      const imageCapture = new ImageCapture(track);
      const bitmap = await imageCapture.grabFrame();

      // DETENER INMEDIATAMENTE - no seguir grabando
      stream.getTracks().forEach(track => track.stop());

      // Convertir a canvas
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0);

      // Convertir a base64
      screenOverlayCapture = canvas.toDataURL('image/png');

      // Restaurar panel
      if (screenOverlayPanel) {
        screenOverlayPanel.style.display = 'flex';
      }

      // Mostrar preview
      if (screenOverlayPreview && screenOverlayPreviewImg) {
        screenOverlayPreviewImg.src = screenOverlayCapture;
        screenOverlayPreview.style.display = 'block';
      }

      // Efecto flash
      showCaptureFlash();

      // Notificación
      showScreenCaptureNotification('📸 ¡Captura lista! Escribe tu pregunta');

      // Enfocar input
      screenOverlayInput?.focus();

    } catch (innerError) {
      // El usuario canceló o hubo error - quitar indicador y restaurar
      captureIndicator.remove();
      throw innerError;
    }

  } catch (error) {
    console.error('Error al capturar pantalla:', error);

    // Restaurar panel
    if (screenOverlayPanel) {
      screenOverlayPanel.style.display = 'flex';
    }

    if (error.name !== 'NotAllowedError') {
      showScreenCaptureNotification('Error al capturar - Inténtalo de nuevo');
    }
  } finally {
    // Quitar animación del botón
    if (screenOverlayCaptureBtn) {
      screenOverlayCaptureBtn.classList.remove('capturing');
    }
  }
}

// Limpiar captura
function clearScreenCapture() {
  screenOverlayCapture = null;
  if (screenOverlayPreview) {
    screenOverlayPreview.style.display = 'none';
  }
  if (screenOverlayPreviewImg) {
    screenOverlayPreviewImg.src = '';
  }
}

// Mostrar flash de captura
function showCaptureFlash() {
  const flash = document.createElement('div');
  flash.className = 'screen-capture-flash';
  document.body.appendChild(flash);

  setTimeout(() => {
    flash.remove();
  }, 300);
}

// Mostrar notificación
function showScreenCaptureNotification(message) {
  // Remover notificación existente
  const existing = document.querySelector('.screen-capture-notification');
  if (existing) existing.remove();

  const notification = document.createElement('div');
  notification.className = 'screen-capture-notification';
  notification.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
    <span>${escapeHtml(message)}</span>
  `;

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.opacity = '0';
    notification.style.transform = 'translateX(-50%) translateY(20px)';
    setTimeout(() => notification.remove(), 300);
  }, 2500);
}

// Enviar mensaje en el overlay
async function sendScreenOverlayMessage() {
  const prompt = screenOverlayInput?.value.trim();
  if (!prompt && !screenOverlayCapture) return;

  // Verificar que hay un modelo seleccionado
  if (!state.currentModel) {
    showScreenCaptureNotification('Selecciona un modelo primero');
    return;
  }

  // Añadir mensaje del usuario
  const userMessage = {
    role: 'user',
    content: prompt || 'Describe lo que ves en esta imagen',
    image: screenOverlayCapture,
    timestamp: Date.now()
  };
  screenOverlayMessages.push(userMessage);

  // Limpiar input
  if (screenOverlayInput) {
    screenOverlayInput.value = '';
    autoResizeOverlayTextarea();
  }

  // Guardar la captura y limpiarla de la preview
  const capturedImage = screenOverlayCapture;
  clearScreenCapture();

  // Renderizar mensajes
  renderOverlayMessages();
  scrollOverlayToBottom();

  // Mostrar loading
  showOverlayLoading();

  // Deshabilitar envío mientras procesa
  if (screenOverlaySendBtn) screenOverlaySendBtn.disabled = true;

  try {
    // Preparar mensajes para la API
    const apiMessages = [];

    // Añadir contexto del sistema
    apiMessages.push({
      role: 'system',
      content: 'Eres un asistente visual experto. El usuario te enviará capturas de pantalla y preguntas sobre lo que ve. Responde de manera concisa pero completa, describiendo y analizando lo que se muestra en las imágenes.'
    });

    // Construir historial de mensajes
    screenOverlayMessages.forEach(msg => {
      const apiMsg = {
        role: msg.role,
        content: msg.content
      };

      // Si hay imagen, añadirla
      if (msg.image && msg.role === 'user') {
        // Extraer solo la parte base64
        const base64Part = msg.image.split(',')[1];
        if (base64Part) {
          apiMsg.images = [base64Part];
        }
      }

      apiMessages.push(apiMsg);
    });

    // Hacer la petición
    const response = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: state.currentModel,
        stream: true,
        messages: apiMessages,
        options: {
          num_ctx: 4096
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Error: ${response.statusText}`);
    }

    // Procesar stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let assistantContent = '';

    // Añadir mensaje del asistente vacío
    const assistantMessage = {
      role: 'assistant',
      content: '',
      timestamp: Date.now()
    };
    screenOverlayMessages.push(assistantMessage);

    // Ocultar loading
    hideOverlayLoading();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const parsed = JSON.parse(line);

          if (parsed.message?.content) {
            assistantContent += parsed.message.content;
            assistantMessage.content = assistantContent;
            renderOverlayMessages();
            scrollOverlayToBottom();
          }

          if (parsed.done) {
            break;
          }
        } catch (e) {
          console.warn('Error parsing stream chunk', e);
        }
      }
    }

    // Actualizar estadísticas
    trackModelUsage(state.currentModel);
    trackDailyMessage();

  } catch (error) {
    console.error('Error en overlay chat:', error);

    // Añadir mensaje de error
    screenOverlayMessages.push({
      role: 'assistant',
      content: `⚠️ Error: ${error.message}`,
      timestamp: Date.now()
    });

    hideOverlayLoading();
    renderOverlayMessages();
  } finally {
    if (screenOverlaySendBtn) screenOverlaySendBtn.disabled = false;
    screenOverlayInput?.focus();
  }
}

// Renderizar mensajes del overlay
function renderOverlayMessages() {
  if (!screenOverlayMessagesContainer) return;

  if (screenOverlayMessages.length === 0) {
    screenOverlayMessagesContainer.innerHTML = `
      <div class="screen-overlay-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48">
          <rect x="2" y="3" width="20" height="14" rx="2"/>
          <circle cx="12" cy="10" r="3"/>
          <path d="M8 21l4-4 4 4"/>
        </svg>
        <p>Captura tu pantalla y pregunta sobre lo que ves</p>
        <span class="hint">Presiona el botón de cámara o Ctrl+Shift+S para capturar</span>
      </div>
    `;
    return;
  }

  let html = '';

  screenOverlayMessages.forEach(msg => {
    const time = formatTime(msg.timestamp);
    const isUser = msg.role === 'user';

    html += `<div class="screen-overlay-message ${msg.role}">`;

    // Si es mensaje del usuario con imagen
    if (isUser && msg.image) {
      html += `<img class="screen-overlay-message-image" src="${msg.image}" alt="Captura"/>`;
    }

    // Contenido del mensaje
    const content = isUser ? escapeHtml(msg.content) : parseMarkdown(msg.content);
    html += `<div class="screen-overlay-message-content">${content}</div>`;

    // Hora
    html += `<span class="screen-overlay-message-time">${time}</span>`;

    html += '</div>';
  });

  screenOverlayMessagesContainer.innerHTML = html;

  // Renderizar matemáticas
  if (typeof renderMathInElement !== 'undefined') {
    renderMathInElement(screenOverlayMessagesContainer, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '$', right: '$', display: false }
      ],
      throwOnError: false
    });
  }
}

// Mostrar loading en el overlay
function showOverlayLoading() {
  const loading = document.createElement('div');
  loading.className = 'screen-overlay-loading';
  loading.id = 'screen-overlay-loading';
  loading.innerHTML = `
    <span>Analizando...</span>
    <div class="screen-overlay-loading-dots">
      <span></span>
      <span></span>
      <span></span>
    </div>
  `;
  screenOverlayMessagesContainer?.appendChild(loading);
  scrollOverlayToBottom();
}

// Ocultar loading
function hideOverlayLoading() {
  const loading = document.getElementById('screen-overlay-loading');
  if (loading) loading.remove();
}

// Scroll al final
function scrollOverlayToBottom() {
  if (screenOverlayMessagesContainer) {
    screenOverlayMessagesContainer.scrollTop = screenOverlayMessagesContainer.scrollHeight;
  }
}

// Auto resize textarea
function autoResizeOverlayTextarea() {
  if (!screenOverlayInput) return;
  screenOverlayInput.style.height = 'auto';
  screenOverlayInput.style.height = Math.min(screenOverlayInput.scrollHeight, 120) + 'px';
}

// Dragging del panel
function startDragging(e) {
  if (e.target.closest('.screen-overlay-btn')) return;

  screenOverlayDragging = true;
  const rect = screenOverlayPanel.getBoundingClientRect();
  screenOverlayDragOffset = {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top
  };

  screenOverlayPanel.style.cursor = 'grabbing';
  e.preventDefault();
}

function handleDragging(e) {
  if (!screenOverlayDragging || !screenOverlayPanel) return;

  const x = e.clientX - screenOverlayDragOffset.x;
  const y = e.clientY - screenOverlayDragOffset.y;

  // Limitar a la ventana
  const maxX = window.innerWidth - screenOverlayPanel.offsetWidth;
  const maxY = window.innerHeight - screenOverlayPanel.offsetHeight;

  screenOverlayPanel.style.left = Math.max(0, Math.min(x, maxX)) + 'px';
  screenOverlayPanel.style.top = Math.max(0, Math.min(y, maxY)) + 'px';
  screenOverlayPanel.style.right = 'auto';
  screenOverlayPanel.style.bottom = 'auto';
}

function stopDragging() {
  screenOverlayDragging = false;
  if (screenOverlayPanel) {
    screenOverlayPanel.style.cursor = '';
  }
}

// También inicializar después de cargar modelos
const originalLoadModels = loadModels;
loadModels = async function () {
  await originalLoadModels.call(this);
  syncOverlayModels();
};



// Initialize translation system
async function initTranslationSystem() {
  if (window.translationManager) {
    await window.translationManager.init();
    initializeLanguageSelector();

    // Subscribe to language changes
    window.translationManager.subscribe(lang => {
      updateDynamicContent(lang);
    });

    // Force initial update of dynamic content (greeting, conversation list)
    // This ensures they match the loaded language, not just the default 'es'
    updateDynamicContent(window.translationManager.currentLang);
  }
}

// Initialize language selector UI
function initializeLanguageSelector() {
  const languageButtons = document.querySelectorAll('.language-button');
  const languageOptions = document.querySelectorAll('.language-option');

  // Toggle menu
  languageButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = btn.nextElementSibling;
      const isVisible = menu.style.display === 'flex';

      // Close all menus first
      document.querySelectorAll('.language-menu').forEach(m => m.style.display = 'none');

      if (!isVisible) {
        menu.style.display = 'flex';
      }
    });
  });

  // Close on click outside
  document.addEventListener('click', () => {
    document.querySelectorAll('.language-menu').forEach(m => m.style.display = 'none');
  });

  // Select language
  languageOptions.forEach(option => {
    option.addEventListener('click', async (e) => {
      e.stopPropagation();
      const lang = option.getAttribute('data-lang');
      // Close menus immediately
      document.querySelectorAll('.language-menu').forEach(m => m.style.display = 'none');
      document.querySelectorAll('.settings-submenu').forEach(m => m.style.display = 'none');

      if (window.translationManager) {
        await window.translationManager.setLanguage(lang);
      }
    });
  });
}

// Update dynamic content on language change
function updateDynamicContent(lang) {
  // Forzar re-renderizado para aplicar el nuevo idioma a los títulos predeterminados
  // renderActiveConversation maneja la lógica de traducción
  if (state.activeId) {
    renderActiveConversation();
  }

  // Re-render conversation list to update relative times
  renderConversationList();

  // Update greeting with new language
  updateUserNameDisplay();

  // Update projects list (empty state text)
  if (typeof renderProjectsList === 'function') {
    renderProjectsList();
  }
}

// ========================================
// Text Selection Quote System
// ========================================

// State for the quote system
const quoteSystemState = {
  selectedText: '',
  source: '', // PDF filename or empty for chat
  isFromPdf: false
};

// Initialize the text selection quote system
function initTextSelectionSystem() {
  const tooltip = document.getElementById('selection-tooltip');
  const quoteCard = document.getElementById('quote-card-inline');
  const quoteClose = document.getElementById('quote-close-inline');

  if (!tooltip) {
    console.warn('Selection tooltip not found');
    return;
  }

  // Hide tooltip on any click
  document.addEventListener('click', () => {
    tooltip.style.display = 'none';
  });

  // Listen for mouseup on chat messages and PDF viewer
  document.addEventListener('mouseup', (e) => {
    // Small delay to ensure selection is complete
    setTimeout(() => {
      handleTextSelection(e, tooltip);
    }, 10);
  });

  // Handle tooltip action clicks
  tooltip.querySelectorAll('.tooltip-action').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.getAttribute('data-action');
      handleTooltipAction(action);
      tooltip.style.display = 'none';
    });
  });

  // Handle quote card close
  if (quoteClose) {
    quoteClose.addEventListener('click', () => {
      hideQuoteCard();
    });
  }

  console.log('✅ Text selection quote system initialized');
}

// Handle text selection event
function handleTextSelection(e, tooltip) {
  const selection = window.getSelection();
  const selectedText = selection.toString().trim();

  // Need at least 5 characters to show tooltip
  if (selectedText.length < 5) {
    return;
  }

  // Check if selection is in a valid area (chat messages or PDF)
  const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer;
  const parentElement = container.nodeType === 3 ? container.parentElement : container;

  // Check if in chat message
  const isInChat = parentElement.closest('.message-bubble, .message-content');
  // Check if in PDF viewer
  const isInPdf = parentElement.closest('.pdf-text-layer, .pdf-viewer-container');

  if (!isInChat && !isInPdf) {
    return;
  }

  // Determine source
  quoteSystemState.selectedText = selectedText;
  quoteSystemState.isFromPdf = !!isInPdf;

  if (isInPdf) {
    // Get the PDF filename from the viewer
    const filenameEl = document.getElementById('pdf-viewer-filename');
    quoteSystemState.source = filenameEl ? filenameEl.textContent : 'PDF';
  } else {
    quoteSystemState.source = '';
  }

  // Position tooltip near selection
  const rect = range.getBoundingClientRect();
  const tooltipX = rect.left + (rect.width / 2);
  const tooltipY = rect.top - 10;

  // Show tooltip
  tooltip.style.display = 'flex';
  tooltip.style.left = `${Math.max(10, tooltipX - 100)}px`;
  tooltip.style.top = `${Math.max(10, tooltipY - 45)}px`;
}

// Handle tooltip action selection
function handleTooltipAction(action) {
  const quoteCard = document.getElementById('quote-card-inline');
  const quoteText = document.getElementById('quote-text-inline');

  if (action === 'follow-up') {
    // Show quote card with selected text - user can write their own question
    if (quoteCard && quoteText) {
      quoteText.textContent = quoteSystemState.selectedText;
      quoteCard.style.display = 'flex';
      // Focus on the input so user can type their question
      focusChatInput();
    }
  } else if (action === 'check-sources') {
    // For check sources, directly send a message asking about sources
    const prompt = quoteSystemState.isFromPdf
      ? `Verifica las fuentes y la veracidad de esta afirmación del documento "${quoteSystemState.source}": "${quoteSystemState.selectedText}"`
      : `Verifica las fuentes y la veracidad de esta afirmación: "${quoteSystemState.selectedText}"`;

    sendQuoteMessage(prompt);
  }

  // Clear selection
  window.getSelection().removeAllRanges();
}

// Focus on the chat input
function focusChatInput() {
  const chatState = document.getElementById('chat-state');
  const isInChatState = chatState && chatState.style.display !== 'none';

  const input = isInChatState
    ? document.getElementById('prompt-input-inline')
    : document.getElementById('prompt-input');

  if (input) {
    input.focus();
  }
}

// Hide the quote card
function hideQuoteCard() {
  const quoteCard = document.getElementById('quote-card-inline');
  if (quoteCard) {
    quoteCard.style.display = 'none';
  }
  quoteSystemState.selectedText = '';
  quoteSystemState.source = '';
}

// Get current quote context for message
function getQuoteContext() {
  if (!quoteSystemState.selectedText) return '';

  if (quoteSystemState.isFromPdf) {
    return `[Referencia del documento "${quoteSystemState.source}"]: "${quoteSystemState.selectedText}"\n\n`;
  }
  return `[Cita seleccionada]: "${quoteSystemState.selectedText}"\n\n`;
}

// Send a quote-based message
function sendQuoteMessage(prompt) {
  // Get the appropriate input element
  const chatState = document.getElementById('chat-state');
  const isInChatState = chatState && chatState.style.display !== 'none';

  const input = isInChatState
    ? document.getElementById('prompt-input-inline')
    : document.getElementById('prompt-input');

  const form = isInChatState
    ? document.getElementById('chat-form-inline')
    : document.getElementById('chat-form');

  if (input && form) {
    input.value = prompt;
    // Trigger submit
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  }

  // Hide quote card after sending
  hideQuoteCard();
}

// Initialize on load
setTimeout(() => {
  initTextSelectionSystem();

  // Intercept form submit to set pending quote context
  const formInline = document.getElementById('chat-form-inline');
  const formMain = document.getElementById('chat-form');

  const setupQuoteContextHandler = (form) => {
    if (!form) return;

    form.addEventListener('submit', (e) => {
      // Check if there's an active quote
      if (quoteSystemState.selectedText) {
        // Set the pending quote context (will be injected in streamAssistantResponse)
        const quoteContext = quoteSystemState.isFromPdf
          ? `El usuario está preguntando sobre el siguiente texto del documento "${quoteSystemState.source}". 
Texto citado: "${quoteSystemState.selectedText}"
Responde específicamente sobre este texto citado.`
          : `El usuario está preguntando sobre el siguiente texto que ha seleccionado.
Texto citado: "${quoteSystemState.selectedText}"
Responde específicamente sobre este texto citado.`;

        window.pendingQuoteContext = quoteContext;

        // Hide quote card after processing
        hideQuoteCard();
      }
    }, true); // Use capture to run before other handlers
  };

  setupQuoteContextHandler(formInline);
  setupQuoteContextHandler(formMain);

}, 1000);

// ========================================
// Music Mode - Generación de Partituras
// ========================================

let currentMusicScore = null;

// Get DOM elements dynamically (they may not exist at script load time)
function getMusicElements() {
  return {
    panel: document.getElementById('music-panel'),
    closeBtn: document.getElementById('music-close-btn'),
    downloadBtn: document.getElementById('music-download-btn'),
    scoreContainer: document.getElementById('music-score'),
    titleText: document.getElementById('music-title-text'),
    timeSig: document.getElementById('music-time-sig'),
    key: document.getElementById('music-key'),
    tempo: document.getElementById('music-tempo')
  };
}

// Toggle music panel visibility
function toggleMusicPanel(show) {
  const { panel } = getMusicElements();
  if (!panel) {
    console.error('🎵 Panel de música no encontrado en el DOM');
    return;
  }

  console.log('🎵 Toggle panel:', show ? 'mostrar' : 'ocultar');

  if (show) {
    document.body.classList.add('music-visible');
    panel.style.display = 'flex';
  } else {
    document.body.classList.remove('music-visible');
    panel.style.display = 'none';
  }
}

// Parse ABC notation from AI response (with backwards compatibility for PARTITURA)
function parseMusicNotation(text) {
  if (!text) return null;

  // Strip markdown formatting
  let cleanText = text
    .replace(/```abc/gi, '[ABC]')
    .replace(/```/g, '[/ABC]')
    .replace(/\*\*\[ABC\]\*\*/gi, '[ABC]')
    .replace(/\*\*\[\/ABC\]\*\*/gi, '[/ABC]')
    .replace(/\*\*\[PARTITURA\]\*\*/gi, '[PARTITURA]')
    .replace(/\*\*\[\/PARTITURA\]\*\*/gi, '[/PARTITURA]');

  // First try ABC format
  const abcMatch = cleanText.match(/\[ABC\]([\s\S]*?)(?:\[\/ABC\]|$)/i);
  if (abcMatch) {
    const abcContent = abcMatch[1].trim();
    console.log('🎵 Contenido ABC encontrado:', abcContent.substring(0, 200));

    const titleMatch = abcContent.match(/^T:\s*(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : 'Partitura';
    const keyMatch = abcContent.match(/^K:\s*(.+)$/m);
    const key = keyMatch ? keyMatch[1].trim() : 'C';
    const meterMatch = abcContent.match(/^M:\s*(.+)$/m);
    const meter = meterMatch ? meterMatch[1].trim() : '4/4';
    const tempoMatch = abcContent.match(/^Q:\s*(.+)$/m);
    const tempo = tempoMatch ? tempoMatch[1].trim() : '1/4=120';

    return {
      abc: abcContent,
      title: title,
      key: key,
      meter: meter,
      tempo: tempo
    };
  }

  // Fallback: try old PARTITURA format and convert to ABC
  const partituraMatch = cleanText.match(/\[PARTITURA\]([\s\S]*?)(?:\[\/PARTITURA\]|$)/i);
  if (partituraMatch) {
    console.log('🎵 Formato PARTITURA detectado, convirtiendo a ABC...');
    const content = partituraMatch[1].trim();

    // Parse old format metadata
    const titulo = content.match(/titulo:\s*(.+?)(?:\n|$)/i)?.[1]?.replace(/[*_"]/g, '').trim() || 'Partitura';
    const compas = content.match(/compas:\s*(\d+\/\d+)/i)?.[1] || '4/4';
    const clave = content.match(/clave:\s*([A-Ga-g][#♯b♭]?\s*(?:mayor|menor|m)?)/i)?.[1]?.trim() || 'C';
    const tempo = content.match(/tempo:\s*(\d+)/i)?.[1] || '120';

    // Extract notes from | ... | lines
    const noteLines = [];
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      // Look for lines starting with | that contain notes
      if (trimmed.startsWith('|') && /[A-Ga-g][#♯b♭]?\d/.test(trimmed)) {
        // Extract note names from the line
        const notes = trimmed.match(/[A-Ga-g][#♯b♭]?\d/g);
        if (notes && notes.length > 0) {
          noteLines.push(notes.join(' '));
        }
      }
    }

    // Convert key format
    let abcKey = clave.replace(/♯/g, '#').replace(/♭/g, 'b');
    if (abcKey.includes('menor') || abcKey.includes(' m')) {
      abcKey = abcKey.replace(/\s*(menor|m)/i, 'm');
    }

    // Build ABC content
    let abcContent = `X:1
T:${titulo}
M:${compas}
L:1/4
Q:1/4=${tempo}
K:${abcKey}
`;

    // Add notes if found
    if (noteLines.length > 0) {
      // Convert notes to ABC format (C4 -> C, c5 -> c, etc.)
      const abcNotes = noteLines.map(line => {
        return line.replace(/([A-Ga-g])([#♯b♭])?(\d)/g, (match, note, acc, oct) => {
          let abcNote = note;
          if (parseInt(oct) >= 5) {
            abcNote = note.toLowerCase();
          } else {
            abcNote = note.toUpperCase();
          }
          if (acc === '#' || acc === '♯') abcNote = '^' + abcNote;
          if (acc === 'b' || acc === '♭') abcNote = '_' + abcNote;
          return abcNote;
        });
      }).join(' | ') + ' |]';
      abcContent += abcNotes;
    } else {
      // Default simple melody if no notes found
      abcContent += 'C D E F | G A B c |]';
    }

    console.log('🎵 ABC generado:', abcContent.substring(0, 200));

    return {
      abc: abcContent,
      title: titulo,
      key: abcKey,
      meter: compas,
      tempo: `1/4=${tempo}`
    };
  }

  console.log('🎵 No se encontró marcador [ABC] ni [PARTITURA]');
  return null;
}

// Render music score using abcjs
function renderMusicScore(parsedMusic) {
  const elements = getMusicElements();
  const { scoreContainer, titleText, timeSig, key: keyEl, tempo: tempoEl } = elements;

  if (!parsedMusic) {
    console.error('🎵 No hay datos de partitura para renderizar');
    return;
  }

  if (!scoreContainer) {
    console.error('🎵 Contenedor de partitura no encontrado');
    return;
  }

  console.log('🎵 Renderizando partitura:', parsedMusic.title);

  // Clear previous content
  scoreContainer.innerHTML = '';

  // Update panel info
  if (titleText) titleText.textContent = parsedMusic.title;
  if (timeSig) timeSig.textContent = parsedMusic.meter;
  if (keyEl) keyEl.textContent = `Tonalidad: ${parsedMusic.key}`;
  if (tempoEl) tempoEl.textContent = parsedMusic.tempo;

  // Check if abcjs is available
  if (typeof ABCJS === 'undefined') {
    console.error('🎵 abcjs no cargado');
    scoreContainer.innerHTML = '<p style="color: #666; text-align: center; padding: 40px;">Error: abcjs no cargado. Recarga la página.</p>';
    return;
  }

  try {
    // Render with abcjs
    ABCJS.renderAbc(scoreContainer, parsedMusic.abc, {
      responsive: 'resize',
      add_classes: true,
      staffwidth: Math.max(350, scoreContainer.clientWidth - 60),
      paddingtop: 20,
      paddingbottom: 20,
      paddingleft: 20,
      paddingright: 20,
      scale: 1.2,
      foregroundColor: '#333333'
    });

    // Store for download
    currentMusicScore = parsedMusic;
    console.log('🎵 Partitura renderizada exitosamente');

  } catch (error) {
    console.error('🎵 Error rendering music score:', error);
    scoreContainer.innerHTML = `<p style="color: #ff6b6b; text-align: center; padding: 40px;">Error al renderizar: ${error.message}</p>`;
  }
}

// Build music instruction for AI - ABC Notation
function buildMusicInstruction() {
  return `🎵 MODO MÚSICA - REGLA OBLIGATORIA:

⚠️ DEBES responder SIEMPRE con un bloque [ABC]. SIN EXCEPCIONES.
⚠️ NO escribas descripciones de música. USA ESTA ESTRUCTURA:

[ABC]
X:1
T:Nombre de la Pieza
M:4/4
L:1/4
K:C
C D E F | G A B c | c B A G | F E D C |
[/ABC]

Breve explicación aquí después del bloque.

Notas: C D E F G A B (octava 4), c d e f g a b (octava 5)
Sostenido: ^C, Bemol: _B, Silencio: z
Duraciones: C2 (blanca), C/2 (corchea), C4 (redonda)

RECUERDA: Si el usuario pide música, partitura, melodía o composición, 
TU RESPUESTA DEBE COMENZAR CON [ABC] - es OBLIGATORIO.`;
}

// Detect music intent in user prompt
function detectMusicIntent(prompt) {
  if (!prompt) return false;

  const keywords = [
    'partitura', 'música', 'musical', 'notas musicales',
    'compón', 'componer', 'melodía', 'acordes', 'pentagrama',
    'sheet music', 'score', 'compose', 'melody',
    'escribe música', 'genera música', 'crea música',
    'canción', 'pieza musical', 'tema musical'
  ];

  const lower = prompt.toLowerCase();
  return keywords.some(k => lower.includes(k));
}

// Process music response from AI - Now uses Score Canvas for editing
function processMusicResponse(conversation, assistantMessage, bubbleElement) {
  if (!conversation || !assistantMessage?.content) return false;

  console.log('🎵 Procesando respuesta de música...');

  const parsedMusic = parseMusicNotation(assistantMessage.content);
  if (!parsedMusic) {
    console.log('🎵 No se pudo parsear la partitura');
    return false;
  }

  console.log('🎵 Partitura parseada:', parsedMusic.title);

  // Save to Score Canvas state for editing
  const scoreEdit = {
    abc: parsedMusic.abc,
    title: parsedMusic.title,
    key: parsedMusic.key,
    meter: parsedMusic.meter,
    tempo: parsedMusic.tempo || '1/4=120'
  };

  // Update or create score document
  updateScoreFromAI(conversation.id, scoreEdit);

  // Get the updated score document to get its ID and version
  const scoreDoc = getScoreDoc(conversation.id);

  // Show the Score Canvas panel (editable)
  toggleScoreCanvasPanel(true);
  renderScoreCanvasPanel(conversation.id);

  // Store for legacy music panel compatibility
  currentMusicScore = parsedMusic;

  // Clean the message content - remove both ABC and PARTITURA blocks
  let cleanContent = assistantMessage.content
    // Remove ABC code blocks
    .replace(/```abc[\s\S]*?```/gi, '')
    // Remove [ABC] blocks
    .replace(/\[ABC\][\s\S]*?\[\/ABC\]/gi, '')
    .replace(/\[ABC\][\s\S]*/gi, '')
    // Remove [PARTITURA] blocks (legacy format)
    .replace(/\*\*\[PARTITURA\]\*\*[\s\S]*?(?:\*\*\[\/PARTITURA\]\*\*|\[\/PARTITURA\])/gi, '')
    .replace(/\[PARTITURA\][\s\S]*?\[\/PARTITURA\]/gi, '')
    .replace(/\[PARTITURA\][\s\S]*/gi, '')
    // Clean up extra whitespace
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  let explanation = cleanContent || `He creado la partitura "${parsedMusic.title}".`;

  // Add score artifact marker for rendering
  explanation = `[SCORE_ARTIFACT]\n\n${explanation}`;

  // Store music data and update message with score reference
  assistantMessage.musicData = parsedMusic;
  assistantMessage.content = explanation;
  assistantMessage.scoreId = scoreDoc?.id;
  assistantMessage.scoreVersion = scoreDoc?.version || 1;

  // Update the bubble in the DOM
  let targetBubble = null;

  if (bubbleElement) {
    targetBubble = bubbleElement.querySelector('.bubble-content') || bubbleElement;
  }

  if (!targetBubble) {
    const lastMessage = document.querySelector('.message.assistant:last-child');
    if (lastMessage) {
      targetBubble = lastMessage.querySelector('.bubble-content') || lastMessage.querySelector('.message-bubble');
    }
  }

  if (targetBubble) {
    const cardHtml = createMusicCard(parsedMusic);
    targetBubble.innerHTML = parseMarkdown(explanation) + cardHtml;
    console.log('🎵 Tarjeta de música añadida al chat (Score Canvas)');
  } else {
    console.warn('🎵 No se pudo encontrar el bubble para actualizar');
  }

  return true;
}

// Create music artifact card HTML - Now opens Score Canvas
function createMusicCard(musicData) {
  if (!musicData) return '';

  return `
    <div class="music-card" onclick="window.showScoreCanvasPanel()">
      <div class="music-card-header">
        <div class="music-card-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 18V5l12-2v13" stroke-linecap="round" stroke-linejoin="round" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
        </div>
        <div class="music-card-info">
          <div class="music-card-title">${escapeHtml(musicData.title)}</div>
          <div class="music-card-meta">${musicData.meter} • ${musicData.key} • Editable</div>
        </div>
      </div>
      <div class="music-card-action">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
        Editar partitura
      </div>
    </div>
  `;
}

// Global function to show music panel - Now opens Score Canvas
window.showMusicPanel = function () {
  // Redirect to Score Canvas for editing
  if (state.activeId) {
    toggleScoreCanvasPanel(true);
    renderScoreCanvasPanel(state.activeId);
  }
};

// Download music as image
function downloadMusicAsImage() {
  const { scoreContainer } = getMusicElements();
  if (!scoreContainer) return;

  const svg = scoreContainer.querySelector('svg');
  if (!svg) return;

  // Create a canvas to convert SVG to image
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  const svgData = new XMLSerializer().serializeToString(svg);
  const img = new Image();

  img.onload = () => {
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);

    const a = document.createElement('a');
    a.download = `${currentMusicScore?.titulo || 'partitura'}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
  };

  img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
}

// Initialize music mode event listeners
function initMusicMode() {
  const elements = getMusicElements();

  // Close button
  if (elements.closeBtn) {
    elements.closeBtn.addEventListener('click', () => {
      toggleMusicPanel(false);
    });
  }

  // Download button
  if (elements.downloadBtn) {
    elements.downloadBtn.addEventListener('click', downloadMusicAsImage);
  }

  console.log('🎵 Music mode initialized');
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initMusicMode);
} else {
  setTimeout(initMusicMode, 100);
}

// Initialize Score Canvas
loadScoreCanvasState();

// ========================================
// Score Canvas - UI and Interaction
// ========================================

let scoreSynthControl = null;

// Toggle score canvas panel visibility
function toggleScoreCanvasPanel(show) {
  const panel = document.getElementById('score-canvas-panel');
  if (!panel) {
    console.error('🎼 Score canvas panel not found');
    return;
  }

  if (show) {
    document.body.classList.add('score-canvas-visible');
    panel.style.display = 'flex';
  } else {
    document.body.classList.remove('score-canvas-visible');
    panel.style.display = 'none';
  }
}

// Render the score canvas panel with current document
function renderScoreCanvasPanel(conversationId) {
  const doc = getScoreDoc(conversationId);
  if (!doc) {
    toggleScoreCanvasPanel(false);
    return;
  }

  toggleScoreCanvasPanel(true);

  // Update title
  const titleInput = document.getElementById('score-title-input');
  if (titleInput) titleInput.value = doc.title || SCORE_CANVAS_DEFAULT_TITLE;

  // Update version badge
  const versionBadge = document.getElementById('score-version-badge');
  if (versionBadge) versionBadge.textContent = 'v' + doc.version;

  // Update editor content
  const editor = document.getElementById('score-abc-editor');
  if (editor) editor.value = doc.abc || '';

  // Update metadata selects
  const timeSigSelect = document.getElementById('score-time-sig');
  const keySelect = document.getElementById('score-key');
  const tempoInput = document.getElementById('score-tempo-input');

  if (timeSigSelect) timeSigSelect.value = doc.meter || '4/4';
  if (keySelect) keySelect.value = doc.key || 'C';
  if (tempoInput) tempoInput.value = parseInt(doc.tempo?.replace(/.*=/, '')) || 120;

  // Update last edit indicator
  const lastEditEl = document.getElementById('score-last-edit');
  if (lastEditEl) {
    lastEditEl.textContent = doc.lastEditBy === 'ai' ? 'Editado por IA' : 'Editado por ti';
    lastEditEl.dataset.editor = doc.lastEditBy;
  }

  // Render preview
  renderScorePreview(doc.abc);
}

// Render the ABC notation in the preview pane
function renderScorePreview(abcContent) {
  const container = document.getElementById('score-preview');
  if (!container) return;

  if (!abcContent || !abcContent.trim()) {
    container.innerHTML = '<p style="color: #999; font-style: italic;">Escribe notación ABC para ver la partitura</p>';
    return;
  }

  if (typeof ABCJS === 'undefined') {
    container.innerHTML = '<p style="color: #f66;">Error: abcjs no cargado</p>';
    return;
  }

  try {
    // Clear cached visual object so playback uses fresh render
    if (typeof clearVisualObj === 'function') {
      clearVisualObj();
    }

    // Clear previous content
    container.innerHTML = '';

    // Ensure container has explicit dimensions
    container.style.minHeight = '200px';

    // Get actual width after layout
    const containerWidth = container.clientWidth || 400;

    ABCJS.renderAbc(container, abcContent, {
      responsive: 'resize',
      add_classes: true,
      staffwidth: Math.max(300, containerWidth - 40),
      paddingtop: 15,
      paddingbottom: 15,
      paddingleft: 10,
      paddingright: 10,
      scale: 1.2,
      foregroundColor: '#000000',  // Pure black for notes
      selectionColor: '#ff7744'
    });

    // Force solid colors on SVG elements
    const svg = container.querySelector('svg');
    if (svg) {
      svg.style.backgroundColor = '#ffffff';
      // Ensure all paths and shapes are solid black
      svg.querySelectorAll('path, line, rect, circle, polygon').forEach(el => {
        if (!el.getAttribute('fill') || el.getAttribute('fill') === 'none') {
          // Skip elements that should not have fill
        } else {
          el.style.opacity = '1';
        }
        el.style.stroke = el.style.stroke || '#000000';
      });
    }

  } catch (error) {
    console.error('🎼 Error rendering score:', error);
    container.innerHTML = `<p style="color: #f66;">Error al renderizar: ${error.message}</p>`;
  }
}

// Initialize Score Canvas event handlers
function initScoreCanvas() {
  const editor = document.getElementById('score-abc-editor');
  const titleInput = document.getElementById('score-title-input');
  const timeSigSelect = document.getElementById('score-time-sig');
  const keySelect = document.getElementById('score-key');
  const tempoInput = document.getElementById('score-tempo-input');
  const closeBtn = document.getElementById('score-close-btn');
  const downloadBtn = document.getElementById('score-download-btn');
  const historyBtn = document.getElementById('score-history-btn');
  const historyDrawer = document.getElementById('score-history-drawer');
  const historyCloseBtn = document.getElementById('score-history-close');
  const playBtn = document.getElementById('score-play-btn');
  const stopBtn = document.getElementById('score-stop-btn');
  const tempoSlider = document.getElementById('playback-tempo');
  const tempoDisplay = document.getElementById('tempo-display');

  // Live preview on editor input (debounced)
  let previewDebounce;
  editor?.addEventListener('input', () => {
    clearTimeout(previewDebounce);
    previewDebounce = setTimeout(() => {
      renderScorePreview(editor.value);
    }, 300);
  });

  // Save on blur
  editor?.addEventListener('blur', () => {
    if (state.activeId && editor.value.trim()) {
      updateScoreFromUser(state.activeId, editor.value);
      updateScoreVersionBadge();
    }
  });

  // Title change
  titleInput?.addEventListener('blur', () => {
    if (state.activeId) {
      const doc = getScoreDoc(state.activeId);
      if (doc && titleInput.value !== doc.title) {
        doc.title = titleInput.value;
        doc.updatedAt = Date.now();
        saveScoreDoc(state.activeId, doc);
      }
    }
  });

  // Metadata changes - update ABC content
  const updateMetadataInABC = () => {
    if (!editor) return;
    let abc = editor.value;

    // Update or add metadata fields
    const meter = timeSigSelect?.value || '4/4';
    const key = keySelect?.value || 'C';
    const tempo = tempoInput?.value || '120';

    abc = abc.replace(/^M:\s*.+$/m, `M:${meter}`) || abc;
    abc = abc.replace(/^K:\s*.+$/m, `K:${key}`) || abc;
    abc = abc.replace(/^Q:\s*.+$/m, `Q:1/4=${tempo}`) || abc;

    if (!abc.includes('M:')) abc = abc.replace(/^(X:\d+\nT:.+\n)/m, `$1M:${meter}\n`);
    if (!abc.includes('Q:')) abc = abc.replace(/^(M:.+\n)/m, `$1Q:1/4=${tempo}\n`);
    if (!abc.includes('K:')) abc = abc + `\nK:${key}`;

    editor.value = abc;
    renderScorePreview(abc);
  };

  timeSigSelect?.addEventListener('change', updateMetadataInABC);
  keySelect?.addEventListener('change', updateMetadataInABC);
  tempoInput?.addEventListener('change', updateMetadataInABC);

  // Close button
  closeBtn?.addEventListener('click', () => {
    toggleScoreCanvasPanel(false);
  });

  // Download as PNG
  downloadBtn?.addEventListener('click', () => {
    const preview = document.getElementById('score-preview');
    const svg = preview?.querySelector('svg');
    if (!svg) return;

    const doc = getScoreDoc(state.activeId);
    const title = doc?.title || 'partitura';

    // Get SVG dimensions
    const svgRect = svg.getBoundingClientRect();
    const svgWidth = svgRect.width;
    const svgHeight = svgRect.height;

    // Scale factor for high quality (3x = 300 DPI equivalent)
    const scale = 3;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    // Set canvas size to scaled dimensions
    canvas.width = svgWidth * scale;
    canvas.height = svgHeight * scale;

    // Create a copy of the SVG with explicit dimensions
    const svgClone = svg.cloneNode(true);
    svgClone.setAttribute('width', svgWidth * scale);
    svgClone.setAttribute('height', svgHeight * scale);

    const svgData = new XMLSerializer().serializeToString(svgClone);
    const img = new Image();

    img.onload = () => {
      // Fill white background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Enable smooth rendering
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      // Draw the image
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      // Download with high quality
      canvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.download = `${title}.png`;
        a.href = url;
        a.click();
        URL.revokeObjectURL(url);
      }, 'image/png', 1.0); // Maximum quality
    };

    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
  });

  // History drawer toggle
  historyBtn?.addEventListener('click', () => {
    if (historyDrawer) {
      historyDrawer.style.display = historyDrawer.style.display === 'none' ? 'flex' : 'none';
      if (historyDrawer.style.display === 'flex') {
        renderHistoryList();
      }
    }
  });

  historyCloseBtn?.addEventListener('click', () => {
    if (historyDrawer) historyDrawer.style.display = 'none';
  });

  // Playback controls
  playBtn?.addEventListener('click', playScore);
  stopBtn?.addEventListener('click', stopScore);

  tempoSlider?.addEventListener('input', (e) => {
    if (tempoDisplay) tempoDisplay.textContent = e.target.value + 'x';
  });

  // AI Edit approval modal handlers
  initScoreEditApprovalHandlers();

  console.log('🎼 Score Canvas initialized');
}

// Update version badge after edit
function updateScoreVersionBadge() {
  const doc = getScoreDoc(state.activeId);
  if (doc) {
    const versionBadge = document.getElementById('score-version-badge');
    if (versionBadge) versionBadge.textContent = 'v' + doc.version;

    const lastEditEl = document.getElementById('score-last-edit');
    if (lastEditEl) {
      lastEditEl.textContent = doc.lastEditBy === 'ai' ? 'Editado por IA' : 'Editado por ti';
      lastEditEl.dataset.editor = doc.lastEditBy;
    }
  }
}

// Render history list in drawer
function renderHistoryList() {
  const list = document.getElementById('score-history-list');
  if (!list) return;

  const history = getScoreHistory(state.activeId);
  const doc = getScoreDoc(state.activeId);

  list.innerHTML = '';

  // Add current version
  if (doc) {
    const currentItem = document.createElement('li');
    currentItem.className = 'score-history-item active';
    currentItem.innerHTML = `
      <span class="history-version">v${doc.version} (actual)</span>
      <span class="history-meta">
        ${new Date(doc.updatedAt).toLocaleString()}
        <span class="history-editor-badge ${doc.lastEditBy}">${doc.lastEditBy === 'ai' ? 'IA' : 'Tú'}</span>
      </span>
    `;
    list.appendChild(currentItem);
  }

  // Add history items (newest first)
  history.slice().reverse().forEach(v => {
    const item = document.createElement('li');
    item.className = 'score-history-item';
    item.innerHTML = `
      <span class="history-version">v${v.version}</span>
      <span class="history-meta">
        ${new Date(v.timestamp).toLocaleString()}
        <span class="history-editor-badge ${v.editedBy}">${v.editedBy === 'ai' ? 'IA' : 'Tú'}</span>
      </span>
    `;
    item.addEventListener('click', () => {
      if (confirm(`¿Restaurar versión ${v.version}?`)) {
        restoreScoreVersion(state.activeId, v.version);
        renderScoreCanvasPanel(state.activeId);
        renderHistoryList();
      }
    });
    list.appendChild(item);
  });
}

// Store the current visual object for playback (avoid re-rendering)
let currentVisualObj = null;
let cursorControl = null;

// Cursor animation class for abcjs
class CursorControl {
  constructor(rootSelector) {
    this.cursor = null;
    this.rootSelector = rootSelector;
    this.beatCallbacksSet = false;
  }

  onReady() {
    // No need to create visual cursor, just track state
    console.log('🎼 Note highlighting ready');
  }

  removeSelection() {
    // Remove previous highlights
    const elements = document.querySelectorAll(this.rootSelector + ' .abcjs-highlight');
    elements.forEach(el => el.classList.remove('abcjs-highlight'));
  }

  onStart() {
    this.removeSelection();
    console.log('🎼 Playback started');
  }

  onFinished() {
    this.removeSelection();
    console.log('🎼 Playback finished');
  }

  onBeat(beatNumber, totalBeats, totalTime) {
    // Optional: could update a progress bar here
  }

  onEvent(event) {
    if (!event || !event.elements || event.elements.length === 0) return;

    // Remove previous highlights
    this.removeSelection();

    // Highlight current notes only
    event.elements.forEach(elemArr => {
      elemArr.forEach(elem => {
        if (elem) {
          elem.classList.add('abcjs-highlight');
        }
      });
    });
  }
}

// Audio playback with piano and cursor animation
async function playScore() {
  const doc = getScoreDoc(state.activeId);
  if (!doc?.abc) return;

  const previewContainer = document.getElementById('score-preview');
  const playBtn = document.getElementById('score-play-btn');
  const stopBtn = document.getElementById('score-stop-btn');
  const tempoSlider = document.getElementById('playback-tempo');

  if (typeof ABCJS === 'undefined' || !ABCJS.synth?.supportsAudio()) {
    console.warn('🎼 Audio not supported');
    return;
  }

  try {
    // Stop any existing playback
    stopScore();

    // Use stored visualObj or render fresh ONLY if not already rendered
    // Check if we already have a valid render
    const existingSvg = previewContainer.querySelector('svg');
    if (!existingSvg || !currentVisualObj) {
      // Get actual width after layout
      const containerWidth = previewContainer.clientWidth || 400;

      // Need to render - use the SAME options as renderScorePreview to avoid visual bugs
      currentVisualObj = ABCJS.renderAbc(previewContainer, doc.abc, {
        responsive: 'resize',
        add_classes: true,
        staffwidth: Math.max(300, containerWidth - 40),
        paddingtop: 15,
        paddingbottom: 15,
        paddingleft: 10,
        paddingright: 10,
        scale: 1.2,
        foregroundColor: '#000000',
        selectionColor: '#ff7744'
      })[0];

      // Force solid colors on SVG elements
      const svg = previewContainer.querySelector('svg');
      if (svg) {
        svg.style.backgroundColor = '#ffffff';
        svg.querySelectorAll('path, line, rect, circle, polygon').forEach(el => {
          el.style.opacity = '1';
          el.style.stroke = el.style.stroke || '#000000';
        });
      }
    }

    // Create cursor control
    cursorControl = new CursorControl('#score-preview');

    // Create synth controller with cursor support
    scoreSynthControl = new ABCJS.synth.SynthController();

    // Initialize audio context if needed
    if (ABCJS.synth.activeAudioContext && ABCJS.synth.activeAudioContext().state === 'suspended') {
      await ABCJS.synth.activeAudioContext().resume();
    }

    const synth = new ABCJS.synth.CreateSynth();
    await synth.init({
      visualObj: currentVisualObj,
      options: {
        program: 0, // Piano sound
        qpm: parseInt(doc.tempo) || 120,
        soundFontUrl: 'https://paulrosen.github.io/midi-js-soundfonts/FluidR3_GM/',
        drum: ''
      }
    });

    // Set tune with cursor callbacks
    await scoreSynthControl.setTune(currentVisualObj, false, {
      chordsOff: false,
      voicesOff: false,
      onEnded: () => {
        console.log('🎼 Playback ended');
        if (cursorControl) cursorControl.onFinished();
        if (playBtn) playBtn.disabled = false;
        if (stopBtn) stopBtn.disabled = true;
      }
    });

    // Set up cursor
    cursorControl.onReady();

    // Create timer with cursor callback
    const timingCallbacks = new ABCJS.TimingCallbacks(currentVisualObj, {
      eventCallback: (event) => {
        if (cursorControl) cursorControl.onEvent(event);
      },
      beatCallback: (beatNumber, totalBeats, totalTime) => {
        if (cursorControl) cursorControl.onBeat(beatNumber, totalBeats, totalTime);
      }
    });

    // Start timer alongside playback
    cursorControl.onStart();
    timingCallbacks.start();

    // Apply tempo multiplier
    const tempoMultiplier = parseFloat(tempoSlider?.value || 1);
    if (tempoMultiplier !== 1) {
      scoreSynthControl.setWarp(tempoMultiplier * 100);
    }

    scoreSynthControl.play();

    // Store timing callbacks for later cleanup
    window._scoreTimingCallbacks = timingCallbacks;

    if (playBtn) playBtn.disabled = true;
    if (stopBtn) stopBtn.disabled = false;

    console.log('🎼 Playback started with cursor animation');

  } catch (error) {
    console.error('🎼 Playback error:', error);
    // Restore buttons on error
    if (playBtn) playBtn.disabled = false;
    if (stopBtn) stopBtn.disabled = true;
  }
}

function stopScore() {
  // Stop timing callbacks
  if (window._scoreTimingCallbacks) {
    try {
      window._scoreTimingCallbacks.stop();
    } catch (e) { }
    window._scoreTimingCallbacks = null;
  }

  // Clean cursor
  if (cursorControl) {
    try {
      cursorControl.onFinished();
    } catch (e) { }
    cursorControl = null;
  }

  // Stop synth
  if (scoreSynthControl) {
    try {
      scoreSynthControl.pause();
    } catch (e) { }
    scoreSynthControl = null;
  }

  // Reset button states
  const playBtn = document.getElementById('score-play-btn');
  const stopBtn = document.getElementById('score-stop-btn');
  if (playBtn) playBtn.disabled = false;
  if (stopBtn) stopBtn.disabled = true;

  console.log('🎼 Playback stopped');
}

// Clear the visual object when score changes
function clearVisualObj() {
  currentVisualObj = null;
}

// AI Edit Approval Modal
function showScoreEditApprovalModal(currentScore, proposedEdit, explanation) {
  pendingScoreEdit = proposedEdit;

  const modal = document.getElementById('score-ai-edit-modal');
  const currentPreview = document.getElementById('score-diff-current');
  const proposedPreview = document.getElementById('score-diff-proposed');
  const explanationEl = document.getElementById('score-diff-explanation-text');

  // Render current version
  if (currentScore?.abc && typeof ABCJS !== 'undefined') {
    ABCJS.renderAbc(currentPreview, currentScore.abc, { scale: 0.7, staffwidth: 300 });
  } else {
    currentPreview.innerHTML = '<p class="empty-score">Partitura vacía</p>';
  }

  // Render proposed version
  if (proposedEdit?.abc && typeof ABCJS !== 'undefined') {
    ABCJS.renderAbc(proposedPreview, proposedEdit.abc, { scale: 0.7, staffwidth: 300 });
  }

  // Set explanation
  if (explanationEl) {
    explanationEl.textContent = explanation || 'Sin explicación proporcionada.';
  }

  if (modal) modal.style.display = 'flex';
}

function closeScoreEditModal() {
  const modal = document.getElementById('score-ai-edit-modal');
  if (modal) modal.style.display = 'none';
  pendingScoreEdit = null;
}

function initScoreEditApprovalHandlers() {
  const approveBtn = document.getElementById('approve-score-edit');
  const rejectBtn = document.getElementById('reject-score-edit');
  const closeBtn = document.getElementById('close-score-edit-modal');

  approveBtn?.addEventListener('click', () => {
    if (pendingScoreEdit && state.activeId) {
      updateScoreFromAI(state.activeId, pendingScoreEdit);
      toggleScoreCanvasPanel(true);
      renderScoreCanvasPanel(state.activeId);
      console.log('🎼 AI edit approved and applied');
    }
    closeScoreEditModal();
  });

  rejectBtn?.addEventListener('click', () => {
    console.log('🎼 AI edit rejected');
    closeScoreEditModal();
  });

  closeBtn?.addEventListener('click', closeScoreEditModal);
}

// Build instruction for AI when score canvas is active
function buildScoreInstruction(conversationId, userPrompt) {
  const doc = getScoreDoc(conversationId);

  // Always include instruction if there's an existing score with real content
  const hasExistingScore = doc && doc.abc && doc.abc.trim().length > 0 && !doc.abc.includes('% Tu música va aquí');

  if (!hasExistingScore) return null;

  // Extract just the notes from the ABC (remove headers)
  const notesOnly = doc.abc
    .split('\n')
    .filter(line => !line.match(/^[A-Z]:|^%/))
    .join(' ')
    .trim();

  // SHORT and DIRECT instruction for small models
  const instruction = `PARTITURA ACTIVA - Versión ${doc.version}

NOTAS ACTUALES: ${notesOnly || '(vacío)'}

REGLA: Para editar la partitura, responde con:
[ABC]
X:1
T:${doc.title}
M:${doc.meter || '4/4'}
L:1/4
Q:${doc.tempo || '1/4=120'}
K:${doc.key || 'C'}
${notesOnly} (+ tus cambios aquí)
[/ABC]

Luego explica los cambios.`;

  return instruction;
}

// Parse [SCORE_EDIT] block from AI response
function parseScoreEdit(text) {
  if (!text) return null;

  const match = text.match(/\[SCORE_EDIT\]([\s\S]*?)\[\/SCORE_EDIT\]/i);
  if (!match) return null;

  const abcContent = match[1].trim();

  // Parse ABC metadata
  const titleMatch = abcContent.match(/^T:\s*(.+)$/m);
  const keyMatch = abcContent.match(/^K:\s*(.+)$/m);
  const meterMatch = abcContent.match(/^M:\s*(.+)$/m);
  const tempoMatch = abcContent.match(/^Q:\s*(.+)$/m);

  return {
    abc: abcContent,
    title: titleMatch?.[1]?.trim() || 'Partitura',
    key: keyMatch?.[1]?.trim() || 'C',
    meter: meterMatch?.[1]?.trim() || '4/4',
    tempo: tempoMatch?.[1]?.trim() || '1/4=120'
  };
}

// Process AI response for score edits (called when stream ends)
function processScoreResponse(conversation, assistantMessage, bubbleElement) {
  if (!assistantMessage?.content) return false;

  const scoreEdit = parseScoreEdit(assistantMessage.content);
  if (!scoreEdit) return false;

  console.log('🎼 AI score edit detected:', scoreEdit.title);

  // Get current score for comparison
  const currentScore = getScoreDoc(conversation.id);

  // Extract explanation (text after the SCORE_EDIT block)
  const explanation = assistantMessage.content
    .replace(/\[SCORE_EDIT\][\s\S]*?\[\/SCORE_EDIT\]/i, '')
    .trim() || 'La IA ha propuesto cambios a la partitura.';

  // Show approval modal instead of applying immediately
  showScoreEditApprovalModal(currentScore, scoreEdit, explanation);

  // Clean the message content for display
  const cleanContent = explanation || `He propuesto cambios para "${scoreEdit.title}".`;

  // Create a card to show the proposed edit
  const cardHtml = createScoreEditCard(scoreEdit);

  // Update the bubble
  let targetBubble = bubbleElement?.querySelector('.bubble-content') || bubbleElement;
  if (!targetBubble) {
    const lastMessage = document.querySelector('.message.assistant:last-child');
    targetBubble = lastMessage?.querySelector('.bubble-content') || lastMessage?.querySelector('.message-bubble');
  }

  if (targetBubble && typeof parseMarkdown === 'function') {
    targetBubble.innerHTML = parseMarkdown(cleanContent) + cardHtml;
  }

  // Update message content (without the SCORE_EDIT block)
  assistantMessage.content = cleanContent;
  assistantMessage.scoreEditProposed = scoreEdit;

  return true;
}

// Create card HTML for proposed score edit
function createScoreEditCard(scoreEdit) {
  if (!scoreEdit) return '';

  return `
    <div class="music-card score-edit-card" onclick="window.showScoreCanvasPanel()">
      <div class="music-card-header">
        <div class="music-card-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 18V5l12-2v13" stroke-linecap="round" stroke-linejoin="round" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
        </div>
        <div class="music-card-info">
          <div class="music-card-title">${escapeHtml(scoreEdit.title)}</div>
          <div class="music-card-meta">${scoreEdit.meter} • ${scoreEdit.key} • Propuesta de cambio</div>
        </div>
      </div>
      <div class="music-card-action">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
          <polyline points="15 3 21 3 21 9"/>
          <line x1="10" y1="14" x2="21" y2="3"/>
        </svg>
        Ver partitura
      </div>
    </div>
  `;
}

// Global function to start score canvas mode
window.startScoreCanvasMode = function (conversationId) {
  scoreCanvasMode = true;
  ensureScoreDoc(conversationId);
  toggleScoreCanvasPanel(true);
  renderScoreCanvasPanel(conversationId);
};

// Global function to show score panel
window.showScoreCanvasPanel = function () {
  if (state.activeId) {
    toggleScoreCanvasPanel(true);
    renderScoreCanvasPanel(state.activeId);
  }
};

// Initialize Score Canvas when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initScoreCanvas);
} else {
  setTimeout(initScoreCanvas, 150);
}

// Export score canvas utils
window.scoreCanvasUtils = {
  toggleScoreCanvasPanel,
  renderScoreCanvasPanel,
  renderScorePreview,
  getScoreDoc,
  saveScoreDoc,
  ensureScoreDoc,
  updateScoreFromUser,
  updateScoreFromAI,
  showScoreEditApprovalModal,
  buildScoreInstruction,
  parseScoreEdit,
  processScoreResponse
};

// Export functions for use in other parts of the app
window.musicModeUtils = {
  parseMusicNotation,
  renderMusicScore,
  buildMusicInstruction,
  detectMusicIntent,
  processMusicResponse,
  createMusicCard,
  toggleMusicPanel
};

// ===========================
// NEWS PANEL / DISCOVER FEATURE
// ===========================

// Import services dynamically
let newsServiceModule = null;
let weatherServiceModule = null;
let locationServiceModule = null;

async function loadNewsServices() {
  try {
    if (!newsServiceModule) {
      newsServiceModule = await import('./services/newsService.js');
    }
    if (!weatherServiceModule) {
      weatherServiceModule = await import('./services/weatherService.js');
    }
    if (!locationServiceModule) {
      locationServiceModule = await import('./services/locationService.js');
    }
    return true;
  } catch (error) {
    console.error('📰 Error loading news services:', error);
    return false;
  }
}

// News panel state
const newsState = {
  activeView: 'chat', // 'chat' | 'news'
  news: [],
  weather: null,
  location: null,
  selectedNews: null,
  loading: false,
  initialized: false
};

// DOM Elements for news panel
const newsPanel = document.getElementById('news-panel');
const discoverButton = document.getElementById('discover-news-btn');
const newsGrid = document.getElementById('news-grid');
const newsLoading = document.getElementById('news-loading');
const newsDetail = document.getElementById('news-detail');
const newsBackBtn = document.getElementById('news-back-btn');
const newsExternalLink = document.getElementById('news-external-link');
const newsDetailContent = document.getElementById('news-detail-content');
const weatherIconEl = document.getElementById('weather-icon');
const weatherTempEl = document.getElementById('weather-temp');
const weatherConditionEl = document.getElementById('weather-condition');
const locationNameEl = document.getElementById('location-name');
const weatherForecastEl = document.getElementById('weather-forecast');

/**
 * Toggle between chat and news view
 * @param {'chat' | 'news'} view 
 */
function toggleNewsView(view) {
  newsState.activeView = view;

  // Get header buttons
  const emptyStateHeader = document.getElementById('empty-state-header');
  const screenOverlayToggleEmpty = document.getElementById('screen-overlay-toggle-empty');
  const incognitoToggleEmpty = document.getElementById('incognito-toggle-empty');

  // Cerrar el panel de proyectos si está abierto
  const projectsPanel = document.getElementById('projects-panel');
  if (projectsPanel && projectsPanel.style.display === 'flex') {
    projectsPanelVisible = false;
    projectsPanel.style.display = 'none';
    const projectsBtn = document.getElementById('projects-panel-btn');
    if (projectsBtn) projectsBtn.classList.remove('active');
  }

  if (view === 'news') {
    // Hide chat views
    if (emptyState) emptyState.style.display = 'none';
    if (chatState) chatState.style.display = 'none';
    if (canvasPanel) canvasPanel.style.display = 'none';

    // Hide empty state header buttons (overlay and incognito)
    if (emptyStateHeader) emptyStateHeader.style.display = 'none';
    if (screenOverlayToggleEmpty) screenOverlayToggleEmpty.style.display = 'none';
    if (incognitoToggleEmpty) incognitoToggleEmpty.style.display = 'none';

    // Show news panel
    if (newsPanel) newsPanel.style.display = 'grid';

    // Mark discover button as active
    if (discoverButton) discoverButton.classList.add('active');

    // Siempre recargar noticias al abrir el panel (para obtener contenido actualizado)
    initializeNewsPanel();

    console.log('📰 Switched to News view');
  } else {
    // Hide news panel
    if (newsPanel) newsPanel.style.display = 'none';
    if (newsDetail) newsDetail.style.display = 'none';

    // Remove active state from discover button
    if (discoverButton) discoverButton.classList.remove('active');

    // Show appropriate chat view
    const hasActiveConversation = state.activeId && state.conversations[state.activeId];
    if (hasActiveConversation) {
      if (emptyState) emptyState.style.display = 'none';
      if (chatState) chatState.style.display = 'flex';
      // Hide empty state header when showing chat
      if (emptyStateHeader) emptyStateHeader.style.display = 'none';
    } else {
      if (emptyState) emptyState.style.display = 'flex';
      if (chatState) chatState.style.display = 'none';
      // Show empty state header when showing empty state
      if (emptyStateHeader) emptyStateHeader.style.display = 'flex';
      if (screenOverlayToggleEmpty) screenOverlayToggleEmpty.style.display = 'flex';
      if (incognitoToggleEmpty) incognitoToggleEmpty.style.display = 'flex';
    }

    console.log('📰 Switched to Chat view');
  }
}

/**
 * Initialize the news panel with location, weather, and news
 */
async function initializeNewsPanel() {
  if (newsState.loading) return;

  console.log('📰 Initializing news panel...');
  newsState.loading = true;

  // Show loading state
  if (newsLoading) newsLoading.style.display = 'flex';
  if (newsGrid) {
    // Clear existing cards except loading
    const existingCards = newsGrid.querySelectorAll('.news-card');
    existingCards.forEach(card => card.remove());
  }

  // Load services
  const servicesLoaded = await loadNewsServices();
  if (!servicesLoaded) {
    console.error('📰 Failed to load news services');
    newsState.loading = false;
    if (newsLoading) {
      newsLoading.innerHTML = '<span style="color: #ef4444;">Error cargando servicios</span>';
    }
    return;
  }

  try {
    // 1. Get user location
    console.log('📰 Getting user location...');
    newsState.location = await locationServiceModule.getUserLocation();
    updateLocationUI(newsState.location);

    // 2. Get weather
    console.log('📰 Getting weather...');
    newsState.weather = await weatherServiceModule.getWeatherByCoords(
      newsState.location.lat,
      newsState.location.lon
    );
    updateWeatherUI(newsState.weather);

    // 3. Fetch news (siempre forzar actualización para obtener noticias nuevas)
    console.log('📰 Fetching news...');
    newsState.news = await newsServiceModule.fetchNews(newsState.location, 'general', true);
    newsState.allNews = [...newsState.news]; // Store all news for filtering
    renderNewsGrid(newsState.news);

    newsState.initialized = true;
    console.log('📰 News panel initialized successfully');
  } catch (error) {
    console.error('📰 Error initializing news panel:', error);
    if (newsLoading) {
      newsLoading.innerHTML = '<span style="color: #ef4444;">Error cargando noticias</span>';
    }
  } finally {
    newsState.loading = false;
  }
}

/**
 * Update location UI
 */
function updateLocationUI(location) {
  if (!location) return;
  if (locationNameEl) {
    locationNameEl.textContent = `${location.city}, ${location.country}`;
  }
}

/**
 * Get weather icon SVG
 */
function getWeatherIconSVG(iconName, size = 32, color = '#FDB813') {
  const icons = {
    'sun': `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`,
    'sun-cloud': `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="M20 12h2"/><path d="m19.07 4.93-1.41 1.41"/><path d="M15.947 12.65a4 4 0 0 0-5.925-4.128"/><path d="M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z"/></svg>`,
    'cloud-sun': `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z"/><path d="M10.083 9A6.002 6.002 0 0 1 16 4a4.243 4.243 0 0 0 6 6c0 2.22-1.206 4.16-3 5.197"/></svg>`,
    'cloud': `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>`,
    'fog': `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M16 17H7"/><path d="M17 21H9"/></svg>`,
    'rain': `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 13v8"/><path d="M8 13v8"/><path d="M12 15v8"/><path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25"/></svg>`,
    'rain-light': `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19v3"/><path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25"/></svg>`,
    'rain-heavy': `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 13v8"/><path d="M8 13v8"/><path d="M12 15v8"/><path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25"/><path d="M8 19v3"/><path d="M16 19v3"/></svg>`,
    'snow': `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 17.58A5 5 0 0 0 18 8h-1.26A8 8 0 1 0 4 16.25"/><line x1="8" y1="16" x2="8.01" y2="16"/><line x1="8" y1="20" x2="8.01" y2="20"/><line x1="12" y1="18" x2="12.01" y2="18"/><line x1="12" y1="22" x2="12.01" y2="22"/><line x1="16" y1="16" x2="16.01" y2="16"/><line x1="16" y1="20" x2="16.01" y2="20"/></svg>`,
    'snow-heavy': `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 17.58A5 5 0 0 0 18 8h-1.26A8 8 0 1 0 4 16.25"/><circle cx="8" cy="18" r="1"/><circle cx="8" cy="22" r="1"/><circle cx="12" cy="16" r="1"/><circle cx="12" cy="20" r="1"/><circle cx="16" cy="18" r="1"/><circle cx="16" cy="22" r="1"/></svg>`,
    'storm': `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 16.9A5 5 0 0 0 18 7h-1.26a8 8 0 1 0-11.62 9"/><polyline points="13 11 9 17 15 17 11 23"/></svg>`
  };

  return icons[iconName] || icons['cloud'];
}

/**
 * Update weather UI
 */
function updateWeatherUI(weather) {
  if (!weather) return;

  if (weatherIconEl) {
    weatherIconEl.innerHTML = getWeatherIconSVG(weather.icon, 36, weather.color);
  }
  if (weatherTempEl) weatherTempEl.textContent = `${weather.temperature}°`;
  if (weatherConditionEl) weatherConditionEl.textContent = weather.condition;

  // Render forecast (only first 5 days)
  if (weatherForecastEl && weather.forecast) {
    weatherForecastEl.innerHTML = weather.forecast.slice(0, 5).map(day => `
      <div class="forecast-day">
        <span class="forecast-day-name">${day.day}</span>
        <span class="forecast-day-icon">${getWeatherIconSVG(day.icon, 20, day.color)}</span>
        <span class="forecast-day-temp">${day.tempMax}°</span>
      </div>
    `).join('');
  }

  // Make weather widget clickable
  const weatherWidget = document.getElementById('weather-widget');
  if (weatherWidget) {
    weatherWidget.style.cursor = 'pointer';
    weatherWidget.onclick = () => openWeatherModal(weather, newsState.location);
  }
}

/**
 * Render news grid
 */
function renderNewsGrid(news) {
  if (!newsGrid || !news) return;

  // Hide loading
  if (newsLoading) newsLoading.style.display = 'none';

  // Clear existing cards
  const existingCards = newsGrid.querySelectorAll('.news-card');
  existingCards.forEach(card => card.remove());

  // Create news cards
  news.forEach((item, index) => {
    const card = createNewsCard(item, index === 0);
    newsGrid.appendChild(card);
  });

  // Show message if no news found
  if (news.length === 0) {
    newsGrid.innerHTML = '<div class="news-empty"><p>No se encontraron noticias para esta categoría</p></div>';
  }
}

/**
 * Create a news card element
 */
function createNewsCard(newsItem, isFeatured = false) {
  const card = document.createElement('div');
  card.className = `news-card ${isFeatured ? 'featured' : ''}`;
  card.dataset.newsId = newsItem.id;
  card.dataset.category = newsItem.category;

  const sourcesCount = newsItem.sources || Math.floor(Math.random() * 80 + 20);

  card.innerHTML = `
    <img class="news-card-image" src="${newsItem.imageUrl}" alt="${escapeHtml(newsItem.title)}" loading="lazy" onerror="this.src='https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=400&h=250&fit=crop'">
    <div class="news-card-content">
      <div class="news-card-header">
      <span class="news-card-category">${escapeHtml(newsItem.category)}</span>
        ${sourcesCount ? `<span class="news-card-sources">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/>
            <path d="M18 14h-8"/>
            <path d="M15 18h-5"/>
            <path d="M10 6h8v4h-8V6Z"/>
          </svg>
          ${sourcesCount} fuentes
        </span>` : ''}
      </div>
      <h3 class="news-card-title">${escapeHtml(newsItem.title)}</h3>
      <p class="news-card-description">${escapeHtml(newsItem.description)}</p>
      <div class="news-card-meta">
        <span class="news-card-source">${escapeHtml(newsItem.source)}</span>
        <span class="news-card-time">${newsItem.timeAgo}</span>
      </div>
    </div>
  `;

  // Click handler to open detail
  card.addEventListener('click', () => {
    openNewsDetail(newsItem);
  });

  return card;
}

/**
 * Open news detail view
 */
function openNewsDetail(newsItem) {
  if (!newsDetail || !newsDetailContent) return;

  newsState.selectedNews = newsItem;

  // Update external link
  if (newsExternalLink) {
    newsExternalLink.href = newsItem.url;
  }

  // Generate extended content based on description
  const extendedContent = generateExtendedContent(newsItem);

  // Generate related tags based on category and content
  const relatedTags = generateRelatedTags(newsItem);

  // Render detail content with more information
  newsDetailContent.innerHTML = `
    <img class="detail-image" src="${newsItem.imageUrl}" alt="${escapeHtml(newsItem.title)}" onerror="this.src='https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=800&h=450&fit=crop'">
    <span class="detail-category">${escapeHtml(newsItem.category)}</span>
    <h1 class="detail-title">${escapeHtml(newsItem.title)}</h1>
    <div class="detail-meta">
      <span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <path d="M2 12h20"/>
        </svg>
        ${escapeHtml(newsItem.source)}
      </span>
      <span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <polyline points="12 6 12 12 16 14"/>
        </svg>
        ${newsItem.timeAgo}
      </span>
      <span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
        ${Math.floor(Math.random() * 5000 + 1000).toLocaleString()} lecturas
      </span>
    </div>
    <p class="detail-description">${escapeHtml(newsItem.description)}</p>
    <div class="detail-full-content">
      ${extendedContent}
    </div>
    <div class="detail-tags">
      ${relatedTags.map(tag => `<span class="detail-tag">#${tag}</span>`).join('')}
    </div>
    <div class="detail-cta">
      <a class="detail-cta-btn" href="${newsItem.url}" target="_blank" rel="noopener">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
          <polyline points="15 3 21 3 21 9"/>
          <line x1="10" y1="14" x2="21" y2="3"/>
        </svg>
        Leer artículo completo
      </a>
      <button class="detail-cta-btn secondary" onclick="closeNewsDetail()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="19" y1="12" x2="5" y2="12"/>
          <polyline points="12 19 5 12 12 5"/>
        </svg>
        Volver a noticias
      </button>
    </div>
  `;

  // Show detail view
  newsDetail.style.display = 'block';
}

/**
 * Generate extended content from news description
 */
function generateExtendedContent(newsItem) {
  // Create more detailed paragraphs based on the category and description
  const paragraphs = [];

  // First paragraph - introduction and context
  paragraphs.push(`<p>Esta noticia ha generado un amplio interés en el sector de ${newsItem.category}, captando la atención de especialistas y público general por igual. Los desarrollos recientes representan un momento significativo que podría tener implicaciones de largo alcance en múltiples ámbitos del mercado global y la sociedad en general.</p>`);

  // Second paragraph - detailed analysis based on category
  const categoryAnalysis = {
    'tecnología': `<p>Los analistas tecnológicos destacan que este tipo de avances representan un punto de inflexión crucial en la industria. Las empresas del sector están monitoreando de cerca estos desarrollos para ajustar sus estrategias de inversión y desarrollo. Según expertos consultados, estamos presenciando una transformación que podría redefinir completamente el panorama tecnológico de los próximos años.</p>
    <p>La carrera por la innovación se ha intensificado entre los principales actores del mercado. Compañías como Microsoft, Google, Meta y Amazon han aumentado significativamente sus presupuestos de I+D para no quedarse atrás. Los inversores de capital riesgo están prestando especial atención a startups que trabajan en tecnologías relacionadas, con valuaciones que han alcanzado niveles históricos.</p>`,

    'economía': `<p>Economistas de instituciones financieras internacionales han expresado sus perspectivas sobre el impacto de estos eventos en los mercados globales. Las proyecciones indican posibles ajustes en las políticas monetarias de los principales bancos centrales, lo que podría afectar las tasas de interés y el acceso al crédito en múltiples economías.</p>
    <p>Los mercados financieros han reaccionado con volatilidad ante estas noticias. Los índices bursátiles principales han experimentado movimientos significativos, mientras que los inversores institucionales reevalúan sus portafolios. Analistas de Wall Street señalan que este tipo de desarrollos suelen tener efectos en cascada que se manifiestan a lo largo de varios trimestres.</p>`,

    'ciencia': `<p>La comunidad científica ha recibido esta noticia con notable interés, señalando que podría abrir nuevas líneas de investigación fundamentales. Los investigadores enfatizan la importancia de continuar financiando proyectos en esta área, destacando el potencial de estos avances para resolver problemas críticos que enfrenta la humanidad.</p>
    <p>Universidades y centros de investigación de todo el mundo están evaluando cómo estos descubrimientos podrían integrarse en sus programas académicos y proyectos en curso. La colaboración internacional se perfila como un factor clave para maximizar el impacto de estos avances científicos.</p>`,

    'política': `<p>Observadores políticos señalan que estos desarrollos podrían influir significativamente en las relaciones internacionales y en las políticas públicas de varios países. Los gobiernos están evaluando las implicaciones de seguridad nacional y las oportunidades de cooperación que podrían surgir.</p>
    <p>Analistas diplomáticos sugieren que estos acontecimientos podrían reconfigurar alianzas tradicionales y abrir nuevos canales de diálogo entre naciones. La comunidad internacional está atenta a las posibles ramificaciones geopolíticas de estos desarrollos.</p>`,

    'deportes': `<p>Los comentaristas deportivos destacan la relevancia histórica de este acontecimiento para el futuro de la disciplina. Los aficionados de todo el mundo han expresado su entusiasmo ante estos desarrollos, que prometen elevar el nivel competitivo a nuevas alturas.</p>
    <p>Las federaciones y organismos deportivos internacionales están evaluando cómo estos cambios podrían afectar las reglas y formatos de competición. Los patrocinadores y marcas deportivas también muestran un creciente interés en capitalizar el momentum generado.</p>`,

    'entretenimiento': `<p>La industria del entretenimiento continúa evolucionando con este tipo de novedades que captan la atención del público global. Los estudios y productoras están reevaluando sus estrategias de contenido para adaptarse a las nuevas tendencias del mercado.</p>
    <p>Las plataformas de streaming y los medios tradicionales compiten por capitalizar el interés generado. Críticos y expertos en medios señalan que estos desarrollos podrían marcar el inicio de una nueva era en la forma en que consumimos entretenimiento.</p>`
  };

  paragraphs.push(categoryAnalysis[newsItem.category?.toLowerCase()] || categoryAnalysis['tecnología']);

  // Third paragraph - expert opinions
  paragraphs.push(`<p><strong>Opiniones de expertos:</strong> Profesionales consultados coinciden en que es fundamental mantener una perspectiva equilibrada ante estos desarrollos. "Estamos en un momento de transición que requiere tanto optimismo como prudencia", señala un especialista del sector. La clave estará en cómo las diferentes partes interesadas respondan a estos cambios en los próximos meses.</p>`);

  // Fourth paragraph - future implications
  paragraphs.push(`<p>De cara al futuro, los expertos anticipan que veremos más desarrollos en esta dirección. Las organizaciones involucradas han indicado que continuarán trabajando en iniciativas relacionadas durante los próximos meses, con planes ambiciosos que podrían amplificar el impacto de lo que hemos presenciado hasta ahora.</p>`);

  // Fifth paragraph - global perspective
  paragraphs.push(`<p>A nivel global, diferentes regiones están adoptando aproximaciones distintas ante estos acontecimientos. Europa, América y Asia muestran dinámicas particulares que reflejan sus prioridades y capacidades únicas. Esta diversidad de respuestas enriquece el debate global y abre posibilidades para soluciones innovadoras que podrían beneficiar a múltiples sectores simultáneamente.</p>`);

  // Sixth paragraph - conclusion
  paragraphs.push(`<p>En conclusión, los desarrollos reportados en esta noticia representan un momento significativo que merece atención continua. Los lectores interesados en profundizar en el tema encontrarán recursos adicionales en las fuentes citadas y en publicaciones especializadas del sector. La evolución de esta historia promete mantener el interés del público durante los próximos meses.</p>`);

  return paragraphs.join('');
}

/**
 * Generate related tags based on news item
 */
function generateRelatedTags(newsItem) {
  const baseTags = [newsItem.category];

  const categoryTags = {
    'tecnología': ['innovación', 'IA', 'digital', 'futuro', 'tech'],
    'economía': ['mercados', 'finanzas', 'inversión', 'global', 'negocios'],
    'ciencia': ['investigación', 'descubrimiento', 'futuro', 'innovación'],
    'política': ['gobierno', 'internacional', 'diplomacia', 'legislación'],
    'deportes': ['competición', 'atletas', 'campeonato', 'récord'],
    'entretenimiento': ['cultura', 'viral', 'trending', 'medios']
  };

  const extraTags = categoryTags[newsItem.category?.toLowerCase()] || categoryTags['tecnología'];

  // Select 3-4 random tags
  const shuffled = extraTags.sort(() => 0.5 - Math.random());
  return [...baseTags, ...shuffled.slice(0, 3)];
}

/**
 * Close news detail view
 */
function closeNewsDetail() {
  if (newsDetail) {
    newsDetail.style.display = 'none';
  }
  newsState.selectedNews = null;
}

// News tabs state
newsState.activeTab = 'para-ti';
newsState.activeCategory = null;
newsState.allNews = [];

// Event Listeners for News Panel
if (discoverButton) {
  discoverButton.addEventListener('click', () => {
    toggleNewsView('news');
  });
}

if (newsBackBtn) {
  newsBackBtn.addEventListener('click', () => {
    closeNewsDetail();
  });
}

// News tabs functionality
const newsTabs = document.querySelectorAll('.news-tab');
newsTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const tabName = tab.dataset.tab;

    // Handle "Temas" dropdown
    if (tabName === 'temas') {
      toggleTemasMenu();
      return;
    }

    // Update active tab
    newsTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    newsState.activeTab = tabName;

    // Filter news based on tab
    filterNewsByTab(tabName);
  });
});

/**
 * Filter news by active tab
 */
function filterNewsByTab(tabName) {
  let filteredNews = [...newsState.allNews];

  if (tabName === 'para-ti') {
    // Show all news, personalized order
    filteredNews = newsState.allNews;
  } else if (tabName === 'mejor') {
    // Sort by sources count (most popular)
    filteredNews = [...newsState.allNews].sort((a, b) => {
      const aCount = a.sources || 0;
      const bCount = b.sources || 0;
      return bCount - aCount;
    });
  }

  // Apply category filter if active
  if (newsState.activeCategory) {
    filteredNews = filteredNews.filter(news =>
      news.category.toLowerCase() === newsState.activeCategory.toLowerCase()
    );
  }

  renderNewsGrid(filteredNews);
}

/**
 * Toggle temas dropdown menu
 */
function toggleTemasMenu() {
  const temasTab = document.querySelector('[data-tab="temas"]');
  const existingMenu = document.querySelector('.temas-dropdown');

  if (existingMenu) {
    existingMenu.remove();
    return;
  }

  // Create dropdown menu
  const dropdown = document.createElement('div');
  dropdown.className = 'temas-dropdown';
  dropdown.innerHTML = `
    <button class="tema-item ${!newsState.activeCategory ? 'active' : ''}" data-category="">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
      </svg>
      Todas las noticias
    </button>
    <button class="tema-item ${newsState.activeCategory === 'tecnología' ? 'active' : ''}" data-category="tecnología">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
        <line x1="8" y1="21" x2="16" y2="21"/>
        <line x1="12" y1="17" x2="12" y2="21"/>
      </svg>
      Tecnología
    </button>
    <button class="tema-item ${newsState.activeCategory === 'economía' ? 'active' : ''}" data-category="economía">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="12" y1="1" x2="12" y2="23"/>
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
      </svg>
      Economía
    </button>
    <button class="tema-item ${newsState.activeCategory === 'política' ? 'active' : ''}" data-category="política">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
        <polyline points="9 22 9 12 15 12 15 22"/>
      </svg>
      Política
    </button>
    <button class="tema-item ${newsState.activeCategory === 'ciencia' ? 'active' : ''}" data-category="ciencia">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M9 3v18l7-3v-9"/>
        <circle cx="17" cy="6" r="3"/>
      </svg>
      Ciencia
    </button>
    <button class="tema-item ${newsState.activeCategory === 'deportes' ? 'active' : ''}" data-category="deportes">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/>
        <path d="M2 12h20"/>
      </svg>
      Deportes
    </button>
    <button class="tema-item ${newsState.activeCategory === 'salud' ? 'active' : ''}" data-category="salud">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
      </svg>
      Salud
    </button>
    <button class="tema-item ${newsState.activeCategory === 'internacional' ? 'active' : ''}" data-category="internacional">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <line x1="2" y1="12" x2="22" y2="12"/>
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
      </svg>
      Internacional
    </button>
    <button class="tema-item ${newsState.activeCategory === 'entretenimiento' ? 'active' : ''}" data-category="entretenimiento">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="5 3 19 12 5 21 5 3"/>
      </svg>
      Entretenimiento
    </button>
    <button class="tema-item ${newsState.activeCategory === 'medio ambiente' ? 'active' : ''}" data-category="medio ambiente">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
        <circle cx="12" cy="12" r="10"/>
      </svg>
      Medio Ambiente
    </button>
  `;

  // Position dropdown below the Temas button using fixed positioning
  document.body.appendChild(dropdown);

  const temasRect = temasTab.getBoundingClientRect();
  dropdown.style.top = `${temasRect.bottom + 8}px`;
  dropdown.style.left = `${temasRect.left}px`;

  // Add click handlers to tema items
  dropdown.querySelectorAll('.tema-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const category = item.dataset.category;
      newsState.activeCategory = category || null;

      // Update active state
      dropdown.querySelectorAll('.tema-item').forEach(t => t.classList.remove('active'));
      item.classList.add('active');

      // Filter news
      filterNewsByTab(newsState.activeTab);

      // Close dropdown
      dropdown.remove();
    });
  });

  // Close dropdown when clicking outside or on backdrop
  dropdown.addEventListener('click', (e) => {
    if (e.target === dropdown) {
      dropdown.remove();
    }
  });

  setTimeout(() => {
    document.addEventListener('click', function closeDropdown(e) {
      if (!dropdown.contains(e.target) && e.target !== temasTab) {
        dropdown.remove();
        document.removeEventListener('click', closeDropdown);
      }
    });
  }, 100);
}

// Modify new conversation button to also switch back to chat view
const originalNewConversationHandler = newConversationButton?.onclick;
if (newConversationButton) {
  newConversationButton.addEventListener('click', () => {
    if (newsState.activeView === 'news') {
      toggleNewsView('chat');
    }
  });
}

// When clicking a conversation in sidebar, switch to chat view
const conversationListEl = document.getElementById('conversation-list');
if (conversationListEl) {
  conversationListEl.addEventListener('click', (e) => {
    const conversationItem = e.target.closest('.conversation-item');
    if (conversationItem && newsState.activeView === 'news') {
      toggleNewsView('chat');
    }
  });
}

/**
 * Open weather detail modal
 */
function openWeatherModal(weather, location) {
  const modal = document.getElementById('weather-modal');
  const modalBody = document.getElementById('weather-modal-body');
  const modalLocation = document.getElementById('weather-modal-location');

  if (!modal || !modalBody) return;

  // Set location title
  if (modalLocation && location) {
    modalLocation.textContent = `${location.city}, ${location.country}`;
  }

  // Generate modal content
  modalBody.innerHTML = `
    <div class="weather-current-detail">
      <div class="weather-current-main">
        <div class="weather-current-icon-large">
          ${getWeatherIconSVG(weather.icon, 80, weather.color)}
        </div>
        <div class="weather-current-info">
          <div class="weather-current-temp-large">${weather.temperature}°</div>
          <div class="weather-current-condition-large">${weather.condition}</div>
          <div class="weather-current-feels">Sensación térmica: ${weather.feelsLike}°</div>
        </div>
      </div>
      
      <div class="weather-stats-grid">
        <div class="weather-stat-card">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>
          </svg>
          <div class="weather-stat-value">${weather.humidity}%</div>
          <div class="weather-stat-label">Humedad</div>
        </div>
        
        <div class="weather-stat-card">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2"/>
          </svg>
          <div class="weather-stat-value">${weather.windSpeed} km/h</div>
          <div class="weather-stat-label">Viento</div>
        </div>
        
        <div class="weather-stat-card">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>
          </svg>
          <div class="weather-stat-value">${weather.forecast[0]?.uvIndex || 0}</div>
          <div class="weather-stat-label">Índice UV</div>
        </div>
        
        <div class="weather-stat-card">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M16 13v8"/><path d="M8 13v8"/><path d="M12 15v8"/><path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25"/>
          </svg>
          <div class="weather-stat-value">${weather.forecast[0]?.precipitation || 0}%</div>
          <div class="weather-stat-label">Precipitación</div>
        </div>
      </div>
    </div>
    
    <div class="weather-forecast-detail">
      <h3 class="weather-section-title">Pronóstico de 7 días</h3>
      <div class="weather-forecast-list">
        ${weather.forecast.map((day, index) => `
          <div class="weather-forecast-item">
            <div class="forecast-item-day">
              <span class="forecast-item-day-name">${index === 0 ? 'Hoy' : day.day}</span>
              <span class="forecast-item-date">${new Date(day.date).toLocaleDateString('es-ES', { month: 'short', day: 'numeric' })}</span>
            </div>
            <div class="forecast-item-icon">
              ${getWeatherIconSVG(day.icon, 32, day.color)}
            </div>
            <div class="forecast-item-condition">${day.condition}</div>
            <div class="forecast-item-temps">
              <span class="temp-max">${day.tempMax}°</span>
              <span class="temp-separator">/</span>
              <span class="temp-min">${day.tempMin}°</span>
            </div>
            <div class="forecast-item-precipitation">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>
              </svg>
              ${day.precipitation}%
            </div>
          </div>
        `).join('')}
      </div>
    </div>
    
    <div class="weather-chart-section">
      <h3 class="weather-section-title">Temperatura de la semana</h3>
      <div class="weather-temperature-chart">
        ${generateTemperatureChart(weather.forecast)}
      </div>
    </div>
  `;

  // Show modal
  modal.style.display = 'flex';

  // Add close handlers
  const closeBtn = document.getElementById('weather-modal-close');
  if (closeBtn) {
    closeBtn.onclick = () => {
      modal.style.display = 'none';
    };
  }

  // Close on backdrop click
  modal.onclick = (e) => {
    if (e.target === modal) {
      modal.style.display = 'none';
    }
  };
}

/**
 * Generate temperature chart visualization
 */
function generateTemperatureChart(forecast) {
  if (!forecast || forecast.length === 0) return '';

  const maxTemp = Math.max(...forecast.map(d => d.tempMax));
  const minTemp = Math.min(...forecast.map(d => d.tempMin));
  const range = maxTemp - minTemp;

  return `
    <div class="temp-chart">
      ${forecast.map((day, index) => {
    const maxHeight = ((day.tempMax - minTemp) / range) * 100;
    const minHeight = ((day.tempMin - minTemp) / range) * 100;

    return `
          <div class="temp-chart-bar">
            <div class="temp-chart-max">${day.tempMax}°</div>
            <div class="temp-chart-bar-container">
              <div class="temp-chart-bar-fill" style="height: ${maxHeight}%; background: linear-gradient(180deg, ${day.color} 0%, ${day.color}80 100%);"></div>
            </div>
            <div class="temp-chart-min">${day.tempMin}°</div>
            <div class="temp-chart-day">${index === 0 ? 'Hoy' : day.day}</div>
          </div>
        `;
  }).join('')}
    </div>
  `;
}

// Export news functions
window.newsPanelUtils = {
  toggleNewsView,
  initializeNewsPanel,
  closeNewsDetail,
  refreshNews: async () => {
    newsState.initialized = false;
    await initializeNewsPanel();
  }
};

// Also expose closeNewsDetail directly for onclick handlers
window.closeNewsDetail = closeNewsDetail;

console.log('📰 News Panel module loaded');

// =====================================================
// TODO PANEL FUNCTIONALITY
// =====================================================

const TODO_STORAGE_KEY = 'ollama-web-todos-v1';

// State for TODO
const todoState = {
  todos: [],
  initialized: false
};

// Load todos from localStorage
function loadTodos() {
  try {
    const saved = localStorage.getItem(TODO_STORAGE_KEY);
    if (saved) {
      todoState.todos = JSON.parse(saved);
    }
  } catch (e) {
    console.error('Error loading todos:', e);
    todoState.todos = [];
  }
}

// Save todos to localStorage
function saveTodos() {
  try {
    localStorage.setItem(TODO_STORAGE_KEY, JSON.stringify(todoState.todos));
  } catch (e) {
    console.error('Error saving todos:', e);
  }
}

// Render TODO list
function renderTodoList() {
  const todoList = document.getElementById('todo-list');
  const todoCount = document.getElementById('todo-count');
  if (!todoList) return;

  const pendingTodos = todoState.todos.filter(t => !t.completed);

  if (todoState.todos.length === 0) {
    todoList.innerHTML = `
      <div class="todo-empty-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M9 11l3 3L22 4"></path>
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
        </svg>
        <p>No hay tareas</p>
        <span>Añade una tarea para empezar</span>
      </div>
    `;
  } else {
    // Group todos by date
    const grouped = {};
    todoState.todos.forEach(todo => {
      const date = new Date(todo.createdAt).toISOString().split('T')[0];
      if (!grouped[date]) grouped[date] = [];
      grouped[date].push(todo);
    });

    // Sort dates descending (newest first)
    const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

    let html = '';
    sortedDates.forEach(date => {
      html += `<div class="todo-date-group">
        <div class="todo-date-header">${formatDateForTodo(date)}</div>`;

      grouped[date].forEach(todo => {
        html += `
          <div class="todo-item ${todo.completed ? 'completed' : ''}" data-id="${todo.id}" draggable="true">
            <button class="todo-checkbox ${todo.completed ? 'checked' : ''}"></button>
            <span class="todo-text" contenteditable="true" data-original-text="${escapeHtml(todo.text)}">${escapeHtml(todo.text)}</span>
            <button class="todo-delete">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        `;
      });

      html += '</div>';
    });

    todoList.innerHTML = html;
  }

  if (todoCount) {
    const count = pendingTodos.length;
    todoCount.textContent = `${count} ${count === 1 ? 'tarea' : 'tareas'}`;
  }
}

// Format date for todo display
function formatDateForTodo(dateStr) {
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const todayStr = today.toISOString().split('T')[0];
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  if (dateStr === todayStr) {
    return 'Hoy';
  } else if (dateStr === yesterdayStr) {
    return 'Ayer';
  } else {
    return dateStr; // YYYY-MM-DD format like in the image
  }
}

// Add a new todo
function addTodo(text) {
  if (!text.trim()) return;

  const todo = {
    id: Date.now().toString(),
    text: text.trim(),
    completed: false,
    createdAt: new Date().toISOString()
  };

  todoState.todos.unshift(todo);
  saveTodos();
  renderTodoList();
}

// Update todo text
function updateTodo(id, newText) {
  const todo = todoState.todos.find(t => t.id === id);
  if (todo && newText.trim()) {
    todo.text = newText.trim();
    saveTodos();
    renderTodoList();
  }
}

// Toggle todo completion
function toggleTodo(id) {
  const todo = todoState.todos.find(t => t.id === id);
  if (todo) {
    todo.completed = !todo.completed;
    saveTodos();
    renderTodoList();
  }
}

// Move todo (reorder)
function moveTodo(fromId, toId) {
  const fromIndex = todoState.todos.findIndex(t => t.id === fromId);
  const toIndex = todoState.todos.findIndex(t => t.id === toId);
  
  if (fromIndex !== -1 && toIndex !== -1) {
    const [movedTodo] = todoState.todos.splice(fromIndex, 1);
    todoState.todos.splice(toIndex, 0, movedTodo);
    saveTodos();
    renderTodoList();
  }
}

// Delete a todo
function deleteTodo(id) {
  todoState.todos = todoState.todos.filter(t => t.id !== id);
  saveTodos();
  renderTodoList();
}

// Clear completed todos
function clearCompletedTodos() {
  todoState.todos = todoState.todos.filter(t => !t.completed);
  saveTodos();
  renderTodoList();
}

// Initialize TODO panel
function initTodoPanel() {
  if (todoState.initialized) return;

  loadTodos();
  renderTodoList();

  // Event listeners
  const todoPanel = document.getElementById('todo-panel');
  const todoPanelBtn = document.getElementById('todo-panel-btn');
  const todoPanelClose = document.getElementById('todo-panel-close');
  const todoInput = document.getElementById('todo-input');
  const todoAddBtn = document.getElementById('todo-add-btn');
  const todoClearCompleted = document.getElementById('todo-clear-completed');
  const todoList = document.getElementById('todo-list');

  if (todoPanelBtn) {
    todoPanelBtn.addEventListener('click', () => {
      if (todoPanel) {
        todoPanel.style.display = todoPanel.style.display === 'none' ? 'flex' : 'none';
        // Close calendar if open
        const calendarPanel = document.getElementById('calendar-panel');
        if (calendarPanel) calendarPanel.style.display = 'none';
        // Close projects panel if open
        const projectsPanel = document.getElementById('projects-panel');
        if (projectsPanel && projectsPanel.style.display === 'flex') {
          projectsPanelVisible = false;
          projectsPanel.style.display = 'none';
          const projectsBtn = document.getElementById('projects-panel-btn');
          if (projectsBtn) projectsBtn.classList.remove('active');
        }
      }
    });
  }

  if (todoPanelClose) {
    todoPanelClose.addEventListener('click', () => {
      if (todoPanel) todoPanel.style.display = 'none';
    });
  }

  if (todoInput && todoAddBtn) {
    todoAddBtn.addEventListener('click', () => {
      addTodo(todoInput.value);
      todoInput.value = '';
    });

    todoInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        addTodo(todoInput.value);
        todoInput.value = '';
      }
    });
  }

  if (todoClearCompleted) {
    todoClearCompleted.addEventListener('click', clearCompletedTodos);
  }

  if (todoList) {
    // Click events
    todoList.addEventListener('click', (e) => {
      const todoItem = e.target.closest('.todo-item');
      if (!todoItem) return;

      const id = todoItem.dataset.id;

      // Si hace clic en eliminar, eliminar
      if (e.target.closest('.todo-delete')) {
        deleteTodo(id);
        return;
      }
      
      // Solo marcar como completado si hace clic en el checkbox
      if (e.target.closest('.todo-checkbox')) {
        toggleTodo(id);
      }
    });

    // Edit text events
    todoList.addEventListener('blur', (e) => {
      if (e.target.classList.contains('todo-text')) {
        const todoItem = e.target.closest('.todo-item');
        const id = todoItem.dataset.id;
        const newText = e.target.textContent.trim();
        const originalText = e.target.dataset.originalText;
        
        if (newText && newText !== originalText) {
          updateTodo(id, newText);
        } else if (!newText) {
          e.target.textContent = originalText;
        }
      }
    }, true);

    todoList.addEventListener('keydown', (e) => {
      if (e.target.classList.contains('todo-text')) {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.target.blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.target.textContent = e.target.dataset.originalText;
          e.target.blur();
        }
      }
    });

    // Drag and drop events
    let draggedElement = null;

    todoList.addEventListener('dragstart', (e) => {
      const todoItem = e.target.closest('.todo-item');
      if (todoItem) {
        draggedElement = todoItem;
        todoItem.style.opacity = '0.4';
      }
    });

    todoList.addEventListener('dragend', (e) => {
      const todoItem = e.target.closest('.todo-item');
      if (todoItem) {
        todoItem.style.opacity = '1';
      }
    });

    todoList.addEventListener('dragover', (e) => {
      e.preventDefault();
      const todoItem = e.target.closest('.todo-item');
      if (todoItem && draggedElement && todoItem !== draggedElement) {
        todoItem.classList.add('drag-over');
      }
    });

    todoList.addEventListener('dragleave', (e) => {
      const todoItem = e.target.closest('.todo-item');
      if (todoItem) {
        todoItem.classList.remove('drag-over');
      }
    });

    todoList.addEventListener('drop', (e) => {
      e.preventDefault();
      const todoItem = e.target.closest('.todo-item');
      if (todoItem && draggedElement && todoItem !== draggedElement) {
        const fromId = draggedElement.dataset.id;
        const toId = todoItem.dataset.id;
        moveTodo(fromId, toId);
      }
      
      // Remove all drag-over classes
      document.querySelectorAll('.todo-item.drag-over').forEach(item => {
        item.classList.remove('drag-over');
      });
    });
  }

  todoState.initialized = true;
  console.log('✅ TODO Panel initialized');

  // Initialize toggle buttons
  initTodoViewToggle();
}

// =====================================================
// TODO VIEW TOGGLE & PLANNED PROJECTS
// =====================================================

const PLANNED_STORAGE_KEY = 'ollama-web-planned-v1';

// State for Planned Projects
const plannedState = {
  projects: [],
  currentProjectId: null,
  initialized: false
};

// Load planned projects from localStorage
function loadPlannedProjects() {
  try {
    const saved = localStorage.getItem(PLANNED_STORAGE_KEY);
    if (saved) {
      plannedState.projects = JSON.parse(saved);
    }
  } catch (e) {
    console.error('Error loading planned projects:', e);
    plannedState.projects = [];
  }
}

// Save planned projects to localStorage
function savePlannedProjects() {
  try {
    localStorage.setItem(PLANNED_STORAGE_KEY, JSON.stringify(plannedState.projects));
  } catch (e) {
    console.error('Error saving planned projects:', e);
  }
}

// Initialize view toggle
function initTodoViewToggle() {
  const toggleBtns = document.querySelectorAll('.todo-toggle-btn');
  const tasksView = document.getElementById('todo-tasks-view');
  const plannedView = document.getElementById('todo-planned-view');

  toggleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;

      // Update toggle buttons
      toggleBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Switch views
      if (view === 'tasks') {
        if (tasksView) tasksView.style.display = 'flex';
        if (plannedView) plannedView.style.display = 'none';
      } else if (view === 'planned') {
        if (tasksView) tasksView.style.display = 'none';
        if (plannedView) plannedView.style.display = 'flex';
        initPlannedView();
      }
    });
  });
}

// Initialize planned view
function initPlannedView() {
  if (!plannedState.initialized) {
    loadPlannedProjects();
    initPlannedEventListeners();
    plannedState.initialized = true;
  }
  renderPlannedProjects();
}

// Initialize planned view event listeners
function initPlannedEventListeners() {
  // Section collapse toggle
  const sectionHeader = document.querySelector('.planned-section-header');
  if (sectionHeader) {
    sectionHeader.addEventListener('click', () => {
      const section = document.getElementById('planned-section-later');
      if (section) section.classList.toggle('collapsed');
    });
  }

  // Add project button - enfoca el input inline
  const addProjectBtn = document.getElementById('add-project-plan-btn');
  const newProjectInput = document.getElementById('new-project-input');

  if (addProjectBtn && newProjectInput) {
    addProjectBtn.addEventListener('click', () => {
      newProjectInput.focus();
    });
  }

  // Input inline para añadir proyecto
  if (newProjectInput) {
    newProjectInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && newProjectInput.value.trim()) {
        addPlannedProject(newProjectInput.value.trim());
        newProjectInput.value = '';
      }
    });
  }

  // Project list click handler
  const projectsList = document.getElementById('planned-projects-list');
  if (projectsList) {
    projectsList.addEventListener('click', (e) => {
      const projectItem = e.target.closest('.planned-project-item');
      if (!projectItem) return;

      const id = projectItem.dataset.id;

      if (e.target.closest('.planned-project-checkbox')) {
        togglePlannedProjectComplete(id);
        return;
      }

      if (e.target.closest('.planned-project-favorite')) {
        togglePlannedProjectFavorite(id);
        return;
      }

      openProjectDetail(id);
    });
  }

  // Back button in detail view
  const backBtn = document.getElementById('planned-project-back-btn');
  if (backBtn) {
    backBtn.addEventListener('click', closeProjectDetail);
  }

  // Project main checkbox in detail
  const projectMainCheckbox = document.getElementById('planned-project-checkbox-main');
  if (projectMainCheckbox) {
    projectMainCheckbox.addEventListener('click', () => {
      if (plannedState.currentProjectId) {
        togglePlannedProjectComplete(plannedState.currentProjectId);
        renderProjectDetail();
      }
    });
  }

  // Favorite button in detail
  const favoriteBtn = document.getElementById('planned-project-favorite-btn');
  if (favoriteBtn) {
    favoriteBtn.addEventListener('click', () => {
      if (plannedState.currentProjectId) {
        togglePlannedProjectFavorite(plannedState.currentProjectId);
        renderProjectDetail();
      }
    });
  }

  // Add subtask input
  const subtaskInput = document.getElementById('planned-add-subtask-input');
  if (subtaskInput) {
    subtaskInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && subtaskInput.value.trim()) {
        addSubtask(subtaskInput.value.trim());
        subtaskInput.value = '';
      }
    });
  }

  // Subtasks list click handler
  const subtasksList = document.getElementById('planned-project-subtasks-list');
  if (subtasksList) {
    subtasksList.addEventListener('click', (e) => {
      const subtaskItem = e.target.closest('.project-subtask-item');
      if (!subtaskItem) return;

      const subtaskId = subtaskItem.dataset.id;

      // Si pulsa en el botón eliminar, eliminar
      if (e.target.closest('.subtask-menu-btn')) {
        deleteSubtask(subtaskId);
        return;
      }

      // Cualquier otro clic en el item lo marca/desmarca
      toggleSubtaskComplete(subtaskId);
    });
  }

  // Delete project button - muestra modal personalizado
  const deleteBtn = document.getElementById('planned-project-delete-btn');
  const deleteModal = document.getElementById('delete-confirm-modal');
  const deleteYes = document.getElementById('delete-confirm-yes');
  const deleteNo = document.getElementById('delete-confirm-no');

  if (deleteBtn && deleteModal && deleteYes && deleteNo) {
    deleteBtn.addEventListener('click', () => {
      if (plannedState.currentProjectId) {
        deleteModal.style.display = 'flex';
      }
    });

    deleteYes.addEventListener('click', () => {
      if (plannedState.currentProjectId) {
        deletePlannedProject(plannedState.currentProjectId);
        deleteModal.style.display = 'none';
        closeProjectDetail();
      }
    });

    deleteNo.addEventListener('click', () => {
      deleteModal.style.display = 'none';
    });

    // Cerrar al hacer clic fuera
    deleteModal.addEventListener('click', (e) => {
      if (e.target === deleteModal) {
        deleteModal.style.display = 'none';
      }
    });
  }

  // Due date button - muestra modal de fecha
  const dueDateBtn = document.getElementById('planned-project-due-date-btn');
  const dateModal = document.getElementById('date-picker-modal');
  const dateInput = document.getElementById('date-picker-input');
  const dateSave = document.getElementById('date-picker-save');
  const dateClear = document.getElementById('date-picker-clear');
  const dateCancel = document.getElementById('date-picker-cancel');

  if (dueDateBtn && dateModal && dateInput && dateSave && dateClear && dateCancel) {
    dueDateBtn.addEventListener('click', () => {
      if (plannedState.currentProjectId) {
        const project = plannedState.projects.find(p => p.id === plannedState.currentProjectId);
        dateInput.value = project?.dueDate || '';
        dateModal.style.display = 'flex';
      }
    });

    dateSave.addEventListener('click', () => {
      if (plannedState.currentProjectId && dateInput.value) {
        setProjectDueDate(plannedState.currentProjectId, dateInput.value);
        dateModal.style.display = 'none';
      }
    });

    dateClear.addEventListener('click', () => {
      if (plannedState.currentProjectId) {
        setProjectDueDate(plannedState.currentProjectId, null);
        dateModal.style.display = 'none';
      }
    });

    dateCancel.addEventListener('click', () => {
      dateModal.style.display = 'none';
    });

    dateModal.addEventListener('click', (e) => {
      if (e.target === dateModal) {
        dateModal.style.display = 'none';
      }
    });
  }

  // Note button - muestra modal de nota
  const noteBtn = document.getElementById('planned-project-note-btn');
  const noteModal = document.getElementById('planned-note-modal');
  const noteTextarea = document.getElementById('planned-note-textarea');
  const noteSave = document.getElementById('planned-note-modal-save');
  const noteClear = document.getElementById('planned-note-modal-clear');
  const noteCancel = document.getElementById('planned-note-modal-cancel');

  if (noteBtn && noteModal && noteTextarea && noteSave && noteClear && noteCancel) {
    noteBtn.addEventListener('click', () => {
      if (plannedState.currentProjectId) {
        const project = plannedState.projects.find(p => p.id === plannedState.currentProjectId);
        noteTextarea.value = project?.note || '';
        noteModal.style.display = 'flex';
      }
    });

    noteSave.addEventListener('click', () => {
      if (plannedState.currentProjectId) {
        setProjectNote(plannedState.currentProjectId, noteTextarea.value.trim());
        noteModal.style.display = 'none';
      }
    });

    noteClear.addEventListener('click', () => {
      if (plannedState.currentProjectId) {
        setProjectNote(plannedState.currentProjectId, null);
        noteModal.style.display = 'none';
      }
    });

    noteCancel.addEventListener('click', () => {
      noteModal.style.display = 'none';
    });

    noteModal.addEventListener('click', (e) => {
      if (e.target === noteModal) {
        noteModal.style.display = 'none';
      }
    });
  }
}

// Add a new planned project
function addPlannedProject(name) {
  const project = {
    id: Date.now().toString(),
    name: name,
    completed: false,
    favorite: false,
    subtasks: [],
    dueDate: null,
    note: null,
    createdAt: new Date().toISOString()
  };

  plannedState.projects.push(project);
  savePlannedProjects();
  renderPlannedProjects();
}

// Toggle project complete
function togglePlannedProjectComplete(id) {
  const project = plannedState.projects.find(p => p.id === id);
  if (project) {
    project.completed = !project.completed;
    savePlannedProjects();
    renderPlannedProjects();
  }
}

// Toggle project favorite
function togglePlannedProjectFavorite(id) {
  const project = plannedState.projects.find(p => p.id === id);
  if (project) {
    project.favorite = !project.favorite;
    savePlannedProjects();
    renderPlannedProjects();
  }
}

// Delete a project
function deletePlannedProject(id) {
  plannedState.projects = plannedState.projects.filter(p => p.id !== id);
  savePlannedProjects();
  renderPlannedProjects();
}

// Set project due date
function setProjectDueDate(id, date) {
  const project = plannedState.projects.find(p => p.id === id);
  if (project) {
    project.dueDate = date || null;
    savePlannedProjects();
    renderProjectDetail();
  }
}

// Set project note
function setProjectNote(id, note) {
  const project = plannedState.projects.find(p => p.id === id);
  if (project) {
    project.note = note || null;
    savePlannedProjects();
    renderProjectDetail();
  }
}

// Add subtask
function addSubtask(text) {
  const project = plannedState.projects.find(p => p.id === plannedState.currentProjectId);
  if (project) {
    project.subtasks.push({
      id: Date.now().toString(),
      text: text,
      completed: false
    });
    savePlannedProjects();
    renderProjectDetail();
  }
}

// Toggle subtask complete
function toggleSubtaskComplete(subtaskId) {
  const project = plannedState.projects.find(p => p.id === plannedState.currentProjectId);
  if (project) {
    const subtask = project.subtasks.find(s => s.id === subtaskId);
    if (subtask) {
      subtask.completed = !subtask.completed;
      savePlannedProjects();
      renderProjectDetail();
      renderPlannedProjects();
    }
  }
}

// Delete subtask
function deleteSubtask(subtaskId) {
  const project = plannedState.projects.find(p => p.id === plannedState.currentProjectId);
  if (project) {
    project.subtasks = project.subtasks.filter(s => s.id !== subtaskId);
    savePlannedProjects();
    renderProjectDetail();
    renderPlannedProjects();
  }
}

// Open project detail view
function openProjectDetail(id) {
  plannedState.currentProjectId = id;

  const detailView = document.getElementById('planned-project-detail-view');
  const plannedHeader = document.querySelector('.planned-header');
  const plannedSection = document.querySelector('.planned-section');

  if (detailView) {
    // Ocultar la lista y header
    if (plannedHeader) plannedHeader.style.display = 'none';
    if (plannedSection) plannedSection.style.display = 'none';

    // Mostrar el detalle
    detailView.style.display = 'flex';
  }

  renderProjectDetail();
}

// Close project detail view
function closeProjectDetail() {
  plannedState.currentProjectId = null;

  const detailView = document.getElementById('planned-project-detail-view');
  const plannedHeader = document.querySelector('.planned-header');
  const plannedSection = document.querySelector('.planned-section');

  if (detailView) {
    // Ocultar el detalle
    detailView.style.display = 'none';

    // Mostrar la lista y header
    if (plannedHeader) plannedHeader.style.display = 'flex';
    if (plannedSection) plannedSection.style.display = 'flex';
  }
}

// Render planned projects list
function renderPlannedProjects() {
  const listEl = document.getElementById('planned-projects-list');
  const countEl = document.getElementById('planned-count');

  if (!listEl) return;

  if (plannedState.projects.length === 0) {
    listEl.innerHTML = `
      <div class="planned-empty-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="3" y="3" width="7" height="7"></rect>
          <rect x="14" y="3" width="7" height="7"></rect>
          <rect x="14" y="14" width="7" height="7"></rect>
          <rect x="3" y="14" width="7" height="7"></rect>
        </svg>
        <p>No hay proyectos planeados</p>
        <span>Añade un proyecto para organizar tus tareas</span>
      </div>
    `;
  } else {
    const sorted = [...plannedState.projects].sort((a, b) => {
      if (a.favorite && !b.favorite) return -1;
      if (!a.favorite && b.favorite) return 1;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    listEl.innerHTML = sorted.map(project => {
      const completedSubtasks = project.subtasks.filter(s => s.completed).length;
      const totalSubtasks = project.subtasks.length;
      const hasAllComplete = totalSubtasks > 0 && completedSubtasks === totalSubtasks;
      const isOverdue = project.dueDate && isDateOverdue(project.dueDate);

      return `
        <div class="planned-project-item ${project.completed ? 'completed' : ''}" data-id="${project.id}">
          <button class="planned-project-checkbox ${project.completed ? 'completed' : ''}"></button>
          <div class="planned-project-info">
            <p class="planned-project-name">${escapeHtml(project.name)}</p>
            <div class="planned-project-meta">
              <span class="planned-project-type">Tareas</span>
              ${totalSubtasks > 0 ? `
                <span class="planned-project-progress ${hasAllComplete ? 'all-complete' : ''}">
                  ${hasAllComplete ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"></path></svg>' : ''}
                  ${completedSubtasks} de ${totalSubtasks}
                </span>
              ` : ''}
              ${project.dueDate ? `
                <span class="planned-project-date ${isOverdue ? 'overdue' : ''}">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                    <line x1="16" y1="2" x2="16" y2="6"></line>
                    <line x1="8" y1="2" x2="8" y2="6"></line>
                    <line x1="3" y1="10" x2="21" y2="10"></line>
                  </svg>
                  ${formatPlannedDueDateShort(project.dueDate)}
                </span>
              ` : ''}
            </div>
          </div>
          <button class="planned-project-favorite ${project.favorite ? 'active' : ''}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
            </svg>
          </button>
        </div>
      `;
    }).join('');
  }

  if (countEl) {
    countEl.textContent = plannedState.projects.length;
  }
}

// Render project detail
function renderProjectDetail() {
  const project = plannedState.projects.find(p => p.id === plannedState.currentProjectId);
  if (!project) return;

  const nameEl = document.getElementById('planned-project-detail-name');
  if (nameEl) {
    nameEl.textContent = project.name;
    nameEl.classList.toggle('completed', project.completed);
  }

  const mainCheckbox = document.getElementById('planned-project-checkbox-main');
  if (mainCheckbox) {
    mainCheckbox.classList.toggle('completed', project.completed);
  }

  const favoriteBtn = document.getElementById('planned-project-favorite-btn');
  if (favoriteBtn) {
    favoriteBtn.classList.toggle('active', project.favorite);
  }

  const subtasksList = document.getElementById('planned-project-subtasks-list');
  if (subtasksList) {
    if (project.subtasks.length === 0) {
      subtasksList.innerHTML = '';
    } else {
      subtasksList.innerHTML = project.subtasks.map(subtask => `
        <div class="project-subtask-item ${subtask.completed ? 'completed' : ''}" data-id="${subtask.id}">
          <button class="subtask-checkbox ${subtask.completed ? 'completed' : ''}"></button>
          <span class="subtask-text">${escapeHtml(subtask.text)}</span>
          <button class="subtask-menu-btn" title="Eliminar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      `).join('');
    }
  }

  const dueDateBtn = document.getElementById('planned-project-due-date-btn');
  const dueDateText = document.getElementById('planned-project-due-date-text');
  if (dueDateBtn && dueDateText) {
    if (project.dueDate) {
      dueDateBtn.classList.add('has-date');
      dueDateText.textContent = `Vence el ${formatPlannedDueDateLong(project.dueDate)}`;
      // Añadir clase overdue si la fecha ha pasado
      if (isDateOverdue(project.dueDate)) {
        dueDateBtn.classList.add('overdue');
      } else {
        dueDateBtn.classList.remove('overdue');
      }
    } else {
      dueDateBtn.classList.remove('has-date');
      dueDateBtn.classList.remove('overdue');
      dueDateText.textContent = 'Agregar fecha de vencimiento';
    }
  }

  // Renderizar nota
  const noteBtn = document.getElementById('planned-project-note-btn');
  const noteText = document.getElementById('planned-project-note-text');
  const noteContainer = document.getElementById('planned-project-note-container');
  const noteContent = document.getElementById('planned-project-note-content');

  if (noteBtn && noteText && noteContainer && noteContent) {
    if (project.note) {
      noteBtn.classList.add('has-note');
      noteText.textContent = 'Editar nota';
      noteContainer.style.display = 'block';
      noteContent.textContent = project.note;
    } else {
      noteBtn.classList.remove('has-note');
      noteText.textContent = 'Agregar nota';
      noteContainer.style.display = 'none';
      noteContent.textContent = '';
    }
  }

  const createdEl = document.getElementById('planned-project-created-date');
  if (createdEl) {
    const created = new Date(project.createdAt);
    createdEl.textContent = `Creada el ${created.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })}`;
  }
}

// Format due date for list (short)
function formatPlannedDueDateShort(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
}

// Format due date for detail (long)
function formatPlannedDueDateLong(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

// Check if date is overdue (past)
function isDateOverdue(dateStr) {
  if (!dateStr) return false;
  const dueDate = new Date(dateStr + 'T23:59:59');
  const now = new Date();
  return dueDate < now;
}

// =====================================================
// CALENDAR PANEL FUNCTIONALITY
// =====================================================

const CALENDAR_STORAGE_KEY = 'ollama-web-calendar-events-v1';

// State for Calendar
const calendarState = {
  events: [],
  currentDate: new Date(),
  selectedDate: null,
  selectedColor: '#d97757',
  initialized: false
};

// Month names in Spanish
const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

// Load events from localStorage
function loadCalendarEvents() {
  try {
    const saved = localStorage.getItem(CALENDAR_STORAGE_KEY);
    if (saved) {
      calendarState.events = JSON.parse(saved);
    }
  } catch (e) {
    console.error('Error loading calendar events:', e);
    calendarState.events = [];
  }
}

// Save events to localStorage
function saveCalendarEvents() {
  try {
    localStorage.setItem(CALENDAR_STORAGE_KEY, JSON.stringify(calendarState.events));
  } catch (e) {
    console.error('Error saving calendar events:', e);
  }
}

// Render calendar grid
function renderCalendar() {
  const monthYearEl = document.getElementById('calendar-month-year');
  const daysEl = document.getElementById('calendar-days');

  if (!monthYearEl || !daysEl) return;

  const year = calendarState.currentDate.getFullYear();
  const month = calendarState.currentDate.getMonth();

  monthYearEl.textContent = `${MONTH_NAMES[month]} ${year}`;

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDay = (firstDay.getDay() + 6) % 7; // Adjust for Monday start
  const daysInMonth = lastDay.getDate();

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  let daysHTML = '';

  // Previous month days
  const prevMonthDays = new Date(year, month, 0).getDate();
  for (let i = startDay - 1; i >= 0; i--) {
    daysHTML += `<div class="calendar-day other-month"><span class="day-number">${prevMonthDays - i}</span></div>`;
  }

  // Current month days
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const isToday = dateStr === todayStr;
    const isSelected = dateStr === calendarState.selectedDate;
    const dayEvents = calendarState.events.filter(e => e.date === dateStr);
    const hasEvent = dayEvents.length > 0;

    let classes = 'calendar-day';
    if (isToday) classes += ' today';
    if (isSelected) classes += ' selected';
    if (hasEvent) classes += ' has-event';

    // Generate event titles (show all)
    let eventsHTML = '';
    if (hasEvent) {
      eventsHTML = dayEvents.map(event =>
        `<span class="day-event-title" style="--event-color: ${event.color}">${escapeHtml(event.title)}</span>`
      ).join('');
    }

    daysHTML += `
      <div class="${classes}" data-date="${dateStr}">
        <span class="day-number">${day}</span>
        <div class="day-events">${eventsHTML}</div>
      </div>`;
  }

  // Next month days
  const remainingDays = 42 - (startDay + daysInMonth);
  for (let day = 1; day <= remainingDays; day++) {
    daysHTML += `<div class="calendar-day other-month"><span class="day-number">${day}</span></div>`;
  }

  daysEl.innerHTML = daysHTML;
}

// Format time for display
function formatTimeDisplay(time) {
  if (!time) return '';
  const [hours, minutes] = time.split(':');
  const h = parseInt(hours);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 || 12;
  return `${hour12}:${minutes} ${ampm}`;
}

// Select a calendar day and show day view
function selectCalendarDay(dateStr) {
  calendarState.selectedDate = dateStr;

  const monthView = document.getElementById('calendar-month-view');
  const dayView = document.getElementById('calendar-day-view');

  if (monthView && dayView) {
    monthView.style.display = 'none';
    dayView.style.display = 'flex';
    renderDayTimeline(dateStr);
  }

  renderCalendar(); // Update selection highlight
}

// Close day view and return to month view
function closeDayView() {
  calendarState.selectedDate = null;

  const monthView = document.getElementById('calendar-month-view');
  const dayView = document.getElementById('calendar-day-view');

  if (monthView && dayView) {
    dayView.style.display = 'none';
    monthView.style.display = 'block';
  }

  renderCalendar();
}

// Render day timeline view
function renderDayTimeline(dateStr) {
  const titleEl = document.getElementById('day-view-title');
  const allDayEl = document.getElementById('allday-events');
  const timelineEl = document.getElementById('day-view-timeline');
  const allDaySection = document.getElementById('day-view-allday');

  if (!titleEl || !allDayEl || !timelineEl) return;

  // Format date title
  const date = new Date(dateStr);
  const weekday = date.toLocaleDateString('es-ES', { weekday: 'long' });
  const day = date.getDate();
  const month = date.toLocaleDateString('es-ES', { month: 'short' });
  const year = date.getFullYear();
  titleEl.textContent = `${weekday.charAt(0).toUpperCase() + weekday.slice(1)} – ${day} ${month} ${year}`;

  // Get events for this day
  const dayEvents = calendarState.events.filter(e => e.date === dateStr);
  const allDayEvents = dayEvents.filter(e => e.allDay);
  const timedEvents = dayEvents.filter(e => !e.allDay && e.startTime);

  // Render all-day events
  if (allDayEvents.length > 0) {
    allDaySection.style.display = 'flex';
    allDayEl.innerHTML = allDayEvents.map(event => `
      <div class="allday-event" style="--event-color: ${event.color}" data-id="${event.id}">
        <span class="allday-event-title">${escapeHtml(event.title)}</span>
      </div>
    `).join('');
  } else {
    allDaySection.style.display = 'none';
  }

  // Constants for timeline
  const HOUR_HEIGHT = 50; // pixels per hour
  const START_HOUR = 8;
  const END_HOUR = 23;

  // Generate hour lines
  let hoursHTML = '';
  for (let hour = START_HOUR; hour <= END_HOUR; hour++) {
    const hourStr = String(hour).padStart(2, '0') + ':00';
    hoursHTML += `
      <div class="timeline-hour" style="height: ${HOUR_HEIGHT}px;">
        <span class="hour-label">${hourStr}</span>
        <div class="hour-line"></div>
      </div>
    `;
  }

  // Generate events with calculated positions and heights
  // First, process events to detect overlaps
  const processedEvents = timedEvents.map(event => {
    const [startH, startM] = event.startTime.split(':').map(Number);
    let endH = startH + 1; // Default 1 hour duration
    let endM = startM;

    if (event.endTime) {
      [endH, endM] = event.endTime.split(':').map(Number);
    }

    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;
    const startOffset = (startH - START_HOUR) + (startM / 60);
    const topPosition = startOffset * HOUR_HEIGHT;
    const durationHours = (endH - startH) + ((endM - startM) / 60);
    const height = Math.max(durationHours * HOUR_HEIGHT, 30);

    return {
      ...event,
      startMinutes,
      endMinutes,
      topPosition,
      height,
      column: 0,
      totalColumns: 1
    };
  });

  // Sort by start time
  processedEvents.sort((a, b) => a.startMinutes - b.startMinutes);

  // Detect overlaps and assign columns
  for (let i = 0; i < processedEvents.length; i++) {
    const current = processedEvents[i];
    const overlapping = [current];

    // Find all events that overlap with current
    for (let j = 0; j < processedEvents.length; j++) {
      if (i === j) continue;
      const other = processedEvents[j];

      // Check if events overlap
      if (current.startMinutes < other.endMinutes && current.endMinutes > other.startMinutes) {
        overlapping.push(other);
      }
    }

    // Assign columns to overlapping events
    const totalColumns = overlapping.length;
    overlapping.forEach((evt, index) => {
      if (evt.totalColumns < totalColumns) {
        evt.totalColumns = totalColumns;
        evt.column = index;
      }
    });
  }

  // Generate HTML with column positioning
  let eventsHTML = '';
  processedEvents.forEach(event => {
    const timeRange = event.endTime
      ? `${event.startTime} - ${event.endTime}`
      : event.startTime;

    // Add small gap between simultaneous events
    const gap = 4; // pixels
    const totalGaps = event.totalColumns > 1 ? (event.totalColumns - 1) * gap : 0;
    const availableWidth = `calc(100% - 70px - ${totalGaps}px)`;
    const width = event.totalColumns > 1
      ? `calc(${availableWidth} / ${event.totalColumns})`
      : 'calc(100% - 70px)';

    const gapOffset = event.column * gap;
    const left = event.totalColumns > 1
      ? `calc(70px + (${availableWidth} / ${event.totalColumns}) * ${event.column} + ${gapOffset}px)`
      : '70px';

    eventsHTML += `
      <div class="timeline-event" 
           style="--event-color: ${event.color}; top: ${event.topPosition}px; height: ${event.height}px; width: ${width}; left: ${left};" 
           data-id="${event.id}">
        <span class="timeline-event-title">${escapeHtml(event.title)}</span>
        <span class="timeline-event-time">${timeRange}</span>
      </div>
    `;
  });

  timelineEl.innerHTML = `
    <div class="timeline-hours">${hoursHTML}</div>
    <div class="timeline-events">${eventsHTML}</div>
  `;
}

// Render events list (only future events)
function renderEventsList() {
  const listEl = document.getElementById('calendar-events-list');
  if (!listEl) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Filter and sort future events
  const futureEvents = calendarState.events.filter(event => {
    const eventDate = new Date(event.date);
    eventDate.setHours(0, 0, 0, 0);
    return eventDate >= today;
  }).sort((a, b) => {
    const dateCompare = new Date(a.date) - new Date(b.date);
    if (dateCompare !== 0) return dateCompare;
    if (a.allDay && !b.allDay) return -1;
    if (!a.allDay && b.allDay) return 1;
    if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime);
    return 0;
  });

  if (futureEvents.length === 0) {
    listEl.innerHTML = `
      <div class="calendar-empty-state">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
          <line x1="16" y1="2" x2="16" y2="6"></line>
          <line x1="8" y1="2" x2="8" y2="6"></line>
          <line x1="3" y1="10" x2="21" y2="10"></line>
        </svg>
        <p>No hay eventos próximos</p>
      </div>
    `;
  } else {
    listEl.innerHTML = futureEvents.map(event => {
      const eventDate = new Date(event.date);
      const todayDate = new Date();
      todayDate.setHours(0, 0, 0, 0);
      eventDate.setHours(0, 0, 0, 0);

      const diffDays = Math.floor((eventDate - todayDate) / (1000 * 60 * 60 * 24));
      let dateLabel = '';
      if (diffDays === 0) dateLabel = 'Hoy';
      else if (diffDays === 1) dateLabel = 'Mañana';
      else dateLabel = eventDate.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });

      let timeStr = '';
      if (event.allDay) {
        timeStr = 'Todo el día';
      } else if (event.startTime) {
        timeStr = formatTimeDisplay(event.startTime);
        if (event.endTime) {
          timeStr += ' - ' + formatTimeDisplay(event.endTime);
        }
      }

      return `
        <div class="calendar-event-item" style="--event-color: ${event.color}" data-id="${event.id}">
          <div class="event-color-dot"></div>
          <div class="event-info">
            <p class="event-title">${escapeHtml(event.title)}</p>
            <p class="event-date">${dateLabel}${timeStr ? ' • ' + timeStr : ''}</p>
          </div>
          <div class="event-actions">
            <button class="event-edit-btn" title="Editar">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
              </svg>
            </button>
            <button class="event-delete-btn" title="Eliminar">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>
      `;
    }).join('');
  }
}

// Add event
function addCalendarEvent(title, date, description, color, startTime, endTime, allDay) {
  if (!title.trim() || !date) return;

  const event = {
    id: Date.now().toString(),
    title: title.trim(),
    date: date,
    description: description?.trim() || '',
    color: color || '#d97757',
    startTime: allDay ? null : (startTime || null),
    endTime: allDay ? null : (endTime || null),
    allDay: allDay || false,
    createdAt: new Date().toISOString()
  };

  calendarState.events.push(event);
  saveCalendarEvents();
  renderCalendar();
  renderEventsList();
}

// Delete event
function deleteCalendarEvent(id) {
  calendarState.events = calendarState.events.filter(e => e.id !== id);
  saveCalendarEvents();
  renderCalendar();
  renderEventsList();
  // Refresh day view if open
  if (calendarState.selectedDate) {
    renderDayTimeline(calendarState.selectedDate);
  }
}

// Open modal to edit event
function openEditEventModal(eventId) {
  const event = calendarState.events.find(e => e.id === eventId);
  if (!event) return;

  const addEventModal = document.getElementById('add-event-modal');
  if (!addEventModal) return;

  // Store editing state
  calendarState.editingEventId = eventId;

  // Update modal title
  const modalTitle = addEventModal.querySelector('.modal-header h3');
  if (modalTitle) modalTitle.textContent = 'Editar evento';

  // Fill form with event data
  const titleInput = document.getElementById('event-title-input');
  const dateInput = document.getElementById('event-date-input');
  const descInput = document.getElementById('event-description-input');
  const startTimeInput = document.getElementById('event-start-time');
  const endTimeInput = document.getElementById('event-end-time');
  const allDayToggle = document.getElementById('event-allday-toggle');
  const timeFields = document.getElementById('event-time-fields');

  if (titleInput) titleInput.value = event.title;
  if (dateInput) dateInput.value = event.date;
  if (descInput) descInput.value = event.description || '';
  if (startTimeInput) startTimeInput.value = event.startTime || '09:00';
  if (endTimeInput) endTimeInput.value = event.endTime || '10:00';
  if (allDayToggle) allDayToggle.checked = event.allDay || false;
  if (timeFields) timeFields.style.display = event.allDay ? 'none' : 'flex';

  // Set selected color
  calendarState.selectedColor = event.color || '#d97757';
  document.querySelectorAll('.color-option').forEach(opt => opt.classList.remove('selected'));
  document.querySelector(`.color-option[data-color="${event.color}"]`)?.classList.add('selected');

  addEventModal.style.display = 'flex';
}

// Update existing event
function updateCalendarEvent(id, title, date, description, color, startTime, endTime, allDay) {
  const eventIndex = calendarState.events.findIndex(e => e.id === id);
  if (eventIndex === -1) return;

  calendarState.events[eventIndex] = {
    ...calendarState.events[eventIndex],
    title: title.trim(),
    date: date,
    description: description?.trim() || '',
    color: color || '#d97757',
    startTime: allDay ? null : (startTime || null),
    endTime: allDay ? null : (endTime || null),
    allDay: allDay || false
  };

  saveCalendarEvents();
  renderCalendar();
  renderEventsList();
  // Refresh day view if open
  if (calendarState.selectedDate) {
    renderDayTimeline(calendarState.selectedDate);
  }
}

// Navigate calendar
function navigateCalendar(direction) {
  const current = calendarState.currentDate;
  calendarState.currentDate = new Date(current.getFullYear(), current.getMonth() + direction, 1);
  renderCalendar();
}

// Initialize Calendar panel
function initCalendarPanel() {
  if (calendarState.initialized) return;

  loadCalendarEvents();
  renderCalendar();
  renderEventsList();

  // Event listeners
  const calendarPanel = document.getElementById('calendar-panel');
  const calendarPanelBtn = document.getElementById('calendar-panel-btn');
  const calendarPanelClose = document.getElementById('calendar-panel-close');
  const calendarPrev = document.getElementById('calendar-prev');
  const calendarNext = document.getElementById('calendar-next');
  const addEventBtn = document.getElementById('add-event-btn');
  const addEventModal = document.getElementById('add-event-modal');
  const closeAddEventModal = document.getElementById('close-add-event-modal');
  const cancelAddEvent = document.getElementById('cancel-add-event');
  const saveEventBtn = document.getElementById('save-event');
  const eventColorPicker = document.getElementById('event-color-picker');
  const eventsList = document.getElementById('calendar-events-list');

  if (calendarPanelBtn) {
    calendarPanelBtn.addEventListener('click', () => {
      if (calendarPanel) {
        calendarPanel.style.display = calendarPanel.style.display === 'none' ? 'flex' : 'none';
        // Close todo if open
        const todoPanel = document.getElementById('todo-panel');
        if (todoPanel) todoPanel.style.display = 'none';
        // Close projects panel if open
        const projectsPanel = document.getElementById('projects-panel');
        if (projectsPanel && projectsPanel.style.display === 'flex') {
          projectsPanelVisible = false;
          projectsPanel.style.display = 'none';
          const projectsBtn = document.getElementById('projects-panel-btn');
          if (projectsBtn) projectsBtn.classList.remove('active');
        }
      }
    });
  }

  if (calendarPanelClose) {
    calendarPanelClose.addEventListener('click', () => {
      if (calendarPanel) calendarPanel.style.display = 'none';
    });
  }

  if (calendarPrev) {
    calendarPrev.addEventListener('click', () => navigateCalendar(-1));
  }

  if (calendarNext) {
    calendarNext.addEventListener('click', () => navigateCalendar(1));
  }

  // Day click event listener (for selecting a day)
  const calendarDays = document.getElementById('calendar-days');
  if (calendarDays) {
    calendarDays.addEventListener('click', (e) => {
      const dayEl = e.target.closest('.calendar-day:not(.other-month)');
      if (dayEl && dayEl.dataset.date) {
        selectCalendarDay(dayEl.dataset.date);
      }
    });
  }

  // Back button from day view
  const dayViewBack = document.getElementById('day-view-back');
  if (dayViewBack) {
    dayViewBack.addEventListener('click', closeDayView);
  }

  // Click on timeline event to edit
  const dayViewTimeline = document.getElementById('day-view-timeline');
  if (dayViewTimeline) {
    dayViewTimeline.addEventListener('click', (e) => {
      const eventEl = e.target.closest('.timeline-event');
      if (eventEl && eventEl.dataset.id) {
        openEditEventModal(eventEl.dataset.id);
      }
    });
  }

  // Click on all-day event to edit
  const allDayEvents = document.getElementById('allday-events');
  if (allDayEvents) {
    allDayEvents.addEventListener('click', (e) => {
      const eventEl = e.target.closest('.allday-event');
      if (eventEl && eventEl.dataset.id) {
        openEditEventModal(eventEl.dataset.id);
      }
    });
  }

  if (addEventBtn) {
    addEventBtn.addEventListener('click', () => {
      if (addEventModal) {
        addEventModal.style.display = 'flex';
        // Clear editing state (we're adding new, not editing)
        calendarState.editingEventId = null;
        // Reset modal title
        const modalTitle = addEventModal.querySelector('.modal-header h3');
        if (modalTitle) modalTitle.textContent = 'Nuevo evento';
        // Reset form
        document.getElementById('event-title-input').value = '';
        document.getElementById('event-date-input').value = new Date().toISOString().split('T')[0];
        document.getElementById('event-description-input').value = '';

        // Reset time fields
        const startTimeInput = document.getElementById('event-start-time');
        const endTimeInput = document.getElementById('event-end-time');
        const allDayToggle = document.getElementById('event-allday-toggle');
        const timeFields = document.getElementById('event-time-fields');

        if (startTimeInput) startTimeInput.value = '09:00';
        if (endTimeInput) endTimeInput.value = '10:00';
        if (allDayToggle) allDayToggle.checked = false;
        if (timeFields) timeFields.style.display = 'flex';

        calendarState.selectedColor = '#d97757';
        // Reset color selection
        document.querySelectorAll('.color-option').forEach(opt => opt.classList.remove('selected'));
        document.querySelector('.color-option[data-color="#d97757"]')?.classList.add('selected');
      }
    });
  }

  // All-day toggle handler
  const allDayToggle = document.getElementById('event-allday-toggle');
  const timeFields = document.getElementById('event-time-fields');

  if (allDayToggle && timeFields) {
    allDayToggle.addEventListener('change', () => {
      timeFields.style.display = allDayToggle.checked ? 'none' : 'flex';
    });
  }

  const closeModal = () => {
    if (addEventModal) addEventModal.style.display = 'none';
    // Reset editing state
    calendarState.editingEventId = null;
    // Reset modal title
    const modalTitle = addEventModal?.querySelector('.modal-header h3');
    if (modalTitle) modalTitle.textContent = 'Nuevo evento';
  };

  if (closeAddEventModal) closeAddEventModal.addEventListener('click', closeModal);
  if (cancelAddEvent) cancelAddEvent.addEventListener('click', closeModal);

  if (saveEventBtn) {
    saveEventBtn.addEventListener('click', () => {
      const title = document.getElementById('event-title-input')?.value;
      const date = document.getElementById('event-date-input')?.value;
      const description = document.getElementById('event-description-input')?.value;
      const startTime = document.getElementById('event-start-time')?.value;
      const endTime = document.getElementById('event-end-time')?.value;
      const isAllDay = document.getElementById('event-allday-toggle')?.checked || false;

      if (title && date) {
        if (calendarState.editingEventId) {
          // Update existing event
          updateCalendarEvent(calendarState.editingEventId, title, date, description, calendarState.selectedColor, startTime, endTime, isAllDay);
        } else {
          // Add new event
          addCalendarEvent(title, date, description, calendarState.selectedColor, startTime, endTime, isAllDay);
        }
        closeModal();
      }
    });
  }

  if (eventColorPicker) {
    eventColorPicker.addEventListener('click', (e) => {
      const colorOption = e.target.closest('.color-option');
      if (colorOption) {
        calendarState.selectedColor = colorOption.dataset.color;
        document.querySelectorAll('.color-option').forEach(opt => opt.classList.remove('selected'));
        colorOption.classList.add('selected');
      }
    });
  }

  if (eventsList) {
    eventsList.addEventListener('click', (e) => {
      const eventItem = e.target.closest('.calendar-event-item');
      if (!eventItem) return;

      const editBtn = e.target.closest('.event-edit-btn');
      const deleteBtn = e.target.closest('.event-delete-btn');

      if (editBtn) {
        openEditEventModal(eventItem.dataset.id);
      } else if (deleteBtn) {
        deleteCalendarEvent(eventItem.dataset.id);
      }
    });
  }

  calendarState.initialized = true;
  console.log('📅 Calendar Panel initialized');
}

// Initialize panels on load
document.addEventListener('DOMContentLoaded', () => {
  initTodoPanel();
  initCalendarPanel();
});

// Also initialize if DOM is already loaded
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  setTimeout(() => {
    initTodoPanel();
    initCalendarPanel();
  }, 100);
}

// ========================================
// PROCESADOR DE COMANDOS DE VIAJES
// ========================================

let processedTravelCommands = new Set(); // Evitar procesar el mismo comando múltiples veces

function processTravelCommands(text) {
  if (!text || !window.travelMode) return;

  // Buscar comandos en el texto usando expresiones regulares

  // Comando para añadir lugar: [ADD_PLACE:nombre|lat|lng|categoria|descripcion]
  const addPlaceRegex = /\[ADD_PLACE:(.*?)\|([-\d.]+)\|([-\d.]+)(?:\|(.*?))?(?:\|(.*?))?\]/g;
  let match;

  while ((match = addPlaceRegex.exec(text)) !== null) {
    const commandId = match[0]; // El comando completo como ID único

    // Solo procesar si no se ha procesado antes
    if (!processedTravelCommands.has(commandId)) {
      processedTravelCommands.add(commandId);

      const name = match[1];
      const lat = parseFloat(match[2]);
      const lng = parseFloat(match[3]);
      const category = match[4] || '';
      const description = match[5] || '';

      if (window.aiAddPlace) {
        window.aiAddPlace(name, lat, lng, category, description);
        console.log(`📍 Lugar añadido: ${name}`);
      }
    }
  }

  // Comando para crear ruta: [CREATE_ROUTE]
  if (text.includes('[CREATE_ROUTE]') && !processedTravelCommands.has('[CREATE_ROUTE]')) {
    processedTravelCommands.add('[CREATE_ROUTE]');
    if (window.aiCreateRoute) {
      window.aiCreateRoute();
      console.log('🗺️ Creando ruta...');
    }
  }

  // Comando para generar link de Google Maps: [GOOGLE_MAPS_LINK]
  if (text.includes('[GOOGLE_MAPS_LINK]') && !processedTravelCommands.has('[GOOGLE_MAPS_LINK]')) {
    processedTravelCommands.add('[GOOGLE_MAPS_LINK]');
    if (window.aiGenerateGoogleMapsLink) {
      window.aiGenerateGoogleMapsLink();
      console.log('🔗 Generando link de Google Maps...');
    }
  }

  // Comando para buscar lugares: [SEARCH_PLACES:query]
  const searchPlacesRegex = /\[SEARCH_PLACES:(.*?)\]/g;
  while ((match = searchPlacesRegex.exec(text)) !== null) {
    const commandId = match[0];
    if (!processedTravelCommands.has(commandId)) {
      processedTravelCommands.add(commandId);
      const query = match[1];
      if (window.aiSearchPlaces) {
        window.aiSearchPlaces(query).then(results => {
          console.log(`🔍 Lugares encontrados para "${query}":`, results);
        });
      }
    }
  }
}

// Limpiar comandos procesados cuando se cambia de conversación
function resetTravelCommands() {
  processedTravelCommands.clear();
}

// =====================================================
//  WEB SPLIT-VIEW & CITATION FUNCTIONS
// =====================================================

// Estado del panel web
window._webPreviewState = {
  isOpen: false,
  currentUrl: null,
  currentSourceId: null,
  readerMode: false
};

// Función para abrir una citación web
window.openWebCitation = function(sourceId, directUrl = '', directTitle = '') {
  console.log(`🔗 Abriendo citación [${sourceId}]`);
  
  // Obtener la fuente del mapa global (última búsqueda)
  const sourcesMap = window._webSourcesMap || [];
  const numericId = parseInt(sourceId, 10);
  const source = sourcesMap.find(s => s.id === numericId);

  // Fallback robusto: usar URL/título incrustados en el badge del mensaje
  const fallbackUrl = (directUrl || '').trim();
  const fallbackTitle = (directTitle || '').trim();
  const finalUrl = source?.url || fallbackUrl;
  const finalTitle = source?.title || fallbackTitle || `Fuente ${sourceId}`;
  
  if (!finalUrl) {
    console.warn(`⚠️ Fuente [${sourceId}] no encontrada`);
    return;
  }
  
  openWebPreview(finalUrl, finalTitle, sourceId);
};

// Función para abrir el panel de vista previa
function openWebPreview(url, title, sourceId) {
  const splitContainer = document.getElementById('web-split-container');
  const chatList = document.getElementById('chat-list');
  const chatListWeb = document.getElementById('chat-list-web');
  const previewPanel = document.getElementById('web-preview-panel');
  const iframe = document.getElementById('web-preview-iframe');
  const urlDisplay = document.getElementById('web-preview-url-display');
  const loading = document.getElementById('web-preview-loading');
  
  if (!splitContainer || !previewPanel) return;
  
  // Activar split-view
  if (chatList && chatListWeb) {
    // Copiar contenido del chat al contenedor split
    chatListWeb.innerHTML = chatList.innerHTML;
    chatList.style.display = 'none';
    splitContainer.style.display = 'flex';
  }
  
  // Actualizar estado
  window._webPreviewState.isOpen = true;
  window._webPreviewState.currentUrl = url;
  window._webPreviewState.currentSourceId = sourceId;
  window._webPreviewState.readerMode = false;
  
  // Mostrar loading
  if (loading) loading.style.display = 'flex';
  if (iframe) iframe.style.display = 'none';
  
  // Actualizar título
  if (urlDisplay) {
    const domain = new URL(url).hostname.replace('www.', '');
    urlDisplay.textContent = title || domain;
  }
  
  // Cargar URL a través del proxy
  const proxyUrl = `http://localhost:3001/proxy?url=${encodeURIComponent(url)}`;
  
  if (iframe) {
    iframe.src = proxyUrl;
    
    iframe.onload = () => {
      if (loading) loading.style.display = 'none';
      if (iframe) iframe.style.display = 'block';
    };
    
    iframe.onerror = () => {
      if (loading) loading.innerHTML = `
        <div style="color: #ef4444; text-align: center;">
          <p>⚠️ No se pudo cargar la página</p>
          <button onclick="window.openWebPreviewInTab('${url}')" style="margin-top: 12px; padding: 8px 16px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; color: #fff; cursor: pointer;">
            Abrir en nueva pestaña →
          </button>
        </div>
      `;
    };
  }
  
  console.log(`📄 Vista previa abierta: ${url}`);
}

// Función para cerrar el panel de vista previa
window.closeWebPreview = function() {
  const splitContainer = document.getElementById('web-split-container');
  const chatList = document.getElementById('chat-list');
  
  if (splitContainer) splitContainer.style.display = 'none';
  if (chatList) chatList.style.display = '';
  
  window._webPreviewState.isOpen = false;
  window._webPreviewState.currentUrl = null;
  window._webPreviewState.currentSourceId = null;
  
  console.log('❌ Vista previa cerrada');
};

// Función para modo lectura
window.toggleWebPreviewReaderMode = function() {
  const currentUrl = window._webPreviewState.currentUrl;
  if (!currentUrl) return;
  
  const iframe = document.getElementById('web-preview-iframe');
  const loading = document.getElementById('web-preview-loading');
  
  window._webPreviewState.readerMode = !window._webPreviewState.readerMode;
  
  if (loading) loading.style.display = 'flex';
  if (iframe) iframe.style.display = 'none';
  
  const url = window._webPreviewState.readerMode
    ? `http://localhost:3001/readability?url=${encodeURIComponent(currentUrl)}`
    : `http://localhost:3001/proxy?url=${encodeURIComponent(currentUrl)}`;
  
  if (iframe) {
    iframe.src = url;
    iframe.onload = () => {
      if (loading) loading.style.display = 'none';
      if (iframe) iframe.style.display = 'block';
    };
  }
  
  console.log(`📖 Modo lectura: ${window._webPreviewState.readerMode ? 'ON' : 'OFF'}`);
};

// Función para abrir en pestaña externa
window.openWebPreviewInTab = function() {
  const currentUrl = window._webPreviewState.currentUrl;
  if (currentUrl) {
    window.open(currentUrl, '_blank');
  }
};

// Configurar event listeners del panel web
function initWebPreviewPanel() {
  const closeBtn = document.getElementById('web-preview-close');
  const readerBtn = document.getElementById('web-preview-reader-mode');
  const externalBtn = document.getElementById('web-preview-open-external');
  const resizeHandle = document.getElementById('web-resize-handle');
  
  if (closeBtn) {
    closeBtn.addEventListener('click', window.closeWebPreview);
  }
  
  if (readerBtn) {
    readerBtn.addEventListener('click', window.toggleWebPreviewReaderMode);
  }
  
  if (externalBtn) {
    externalBtn.addEventListener('click', window.openWebPreviewInTab);
  }
  
  // Configurar toggle de tipo de búsqueda
  const toggleButtons = document.querySelectorAll('.web-search-type-btn');
  toggleButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      // Remover active de todos
      toggleButtons.forEach(b => b.classList.remove('active'));
      // Añadir active al clickeado
      btn.classList.add('active');
      // Guardar tipo de búsqueda
      window._webSearchType = btn.dataset.type;
      console.log(`🔍 Tipo de búsqueda cambiado a: ${window._webSearchType}`);
    });
  });
  
  // Inicializar tipo de búsqueda por defecto
  if (!window._webSearchType) {
    window._webSearchType = 'general';
  }
  
  // Resize handle para ajustar ancho del panel
  if (resizeHandle) {
    let isResizing = false;
    let startX = 0;
    let startWidth = 0;
    
    resizeHandle.addEventListener('mousedown', (e) => {
      isResizing = true;
      startX = e.clientX;
      const previewPanel = document.getElementById('web-preview-panel');
      if (previewPanel) {
        startWidth = previewPanel.offsetWidth;
      }
      document.body.style.cursor = 'col-resize';
      e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      
      const previewPanel = document.getElementById('web-preview-panel');
      if (!previewPanel) return;
      
      const diff = startX - e.clientX;
      const newWidth = startWidth + diff;
      
      // Limitar ancho entre 300px y 70% del viewport
      const minWidth = 300;
      const maxWidth = window.innerWidth * 0.7;
      
      if (newWidth >= minWidth && newWidth <= maxWidth) {
        previewPanel.style.width = `${newWidth}px`;
      }
    });
    
    document.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        document.body.style.cursor = '';
      }
    });
  }
  
  console.log('✅ Panel de vista previa web inicializado');
}

// Inicializar al cargar la página
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initWebPreviewPanel);
} else {
  initWebPreviewPanel();
}

console.log('✅ Web preview, TODO and Calendar modules loaded');
