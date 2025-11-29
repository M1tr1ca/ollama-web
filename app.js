const API_BASE = 'http://localhost:11434';
const STORAGE_KEY = 'ollama-web-state-v1';
const DEFAULT_TITLE = 'Nueva conversación';
const BACKGROUND_STORAGE_KEY = 'ollama-web-background-date';
const DYSLEXIC_FONT_KEY = 'ollama-web-dyslexic-font';

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

const state = {
  conversations: {},
  order: [],
  activeId: null,
  currentModel: null,
  loading: false,
};

// Archivos adjuntos por conversación
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
  if (conversation.title && conversation.title !== DEFAULT_TITLE) return;
  const firstUserMessage = conversation.messages.find((msg) => msg.role === 'user');
  if (!firstUserMessage) return;
  const trimmed = firstUserMessage.content.trim();
  if (!trimmed) return;
  conversation.title = trimmed.length > 42 ? `${trimmed.slice(0, 42)}…` : trimmed;
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return '';
  const diff = Date.now() - timestamp;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return 'Actualizado hace unos segundos';
  if (diff < hour) {
    const minutes = Math.round(diff / minute);
    return `Actualizado hace ${minutes} min`;
  }
  if (diff < day) {
    const hours = Math.round(diff / hour);
    return `Actualizado hace ${hours} h`;
  }
  const date = new Date(timestamp);
  return `Actualizado ${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

function formatTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

function parseMarkdown(text) {
  if (!text) return '';
  
  // Configurar marked y highlight.js una sola vez
  if (!window.markedConfigured && typeof marked !== 'undefined' && typeof hljs !== 'undefined') {
    marked.use({
      renderer: {
        code({text, lang}) {
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

  // Parsear markdown
  let html = marked.parse(protectedText);

  // Restaurar fórmulas matemáticas
  html = html.replace(/MATH_BLOCK_PLACEHOLDER_(\d+)/g, (match, index) => {
    return mathBlocks[index];
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
window.copyCodeBlock = async function(button) {
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
    // Es un mensaje de Deep Research completado - mostrar con encabezado especial
    content += `
      <div class="deep-research-report">
        <div class="deep-research-report-header">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="7"/>
            <path d="M11 8v6M8 11h6"/>
            <path d="M16 16l4 4"/>
          </svg>
          Deep Research • ${message.deepResearch.findings || 0} temas investigados
        </div>
      </div>
    `;
    content += parseMarkdown(message.content);
  } else if (message.content) {
    content += parseMarkdown(message.content);
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
  copyContainer.appendChild(timeElement)
  
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
        {left: '$$', right: '$$', display: true},
        {left: '$', right: '$', display: false}
      ],
      throwOnError: false
    });
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
  conversationTitle.textContent = conversation.title ?? DEFAULT_TITLE;
  updateAttachmentsBadge(); // Actualizar badge al cambiar de conversación
}

function showEmptyState() {
  if (emptyState) emptyState.style.display = 'flex';
  if (chatState) chatState.style.display = 'none';
  // Mostrar botón incógnito del empty-state y ocultar el del chat
  if (incognitoButtonEmpty) incognitoButtonEmpty.style.display = 'flex';
  if (incognitoButton) incognitoButton.style.display = 'none';
}

function showChatState() {
  if (emptyState) emptyState.style.display = 'none';
  if (chatState) chatState.style.display = 'flex';
  // Ocultar botón incógnito del empty-state y mostrar el del chat
  if (incognitoButtonEmpty) incognitoButtonEmpty.style.display = 'none';
  if (incognitoButton) incognitoButton.style.display = 'flex';
}

function renderConversationList() {
  if (!conversationList) return;
  conversationList.innerHTML = '';

  if (state.order.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'conversation-item';
    empty.textContent = 'No hay conversaciones todavía';
    conversationList.appendChild(empty);
    return;
  }

  state.order.forEach((id) => {
    const conversation = state.conversations[id];
    if (!conversation) return;

    const item = document.createElement('li');
    item.className = `conversation-item${id === state.activeId ? ' active' : ''}`;
    
    // Añadir clase si pertenece a un proyecto
    if (conversation.projectId && projectsState?.projects[conversation.projectId]) {
      item.classList.add('has-project');
    }

    const textBlock = document.createElement('div');
    textBlock.className = 'conversation-text';

    const name = document.createElement('p');
    name.className = 'conversation-name';
    name.textContent = conversation.title ?? DEFAULT_TITLE;
    
    // Mostrar etiqueta del proyecto si existe
    if (conversation.projectId && projectsState?.projects[conversation.projectId]) {
      const projectTag = document.createElement('span');
      projectTag.className = 'conversation-project-tag';
      projectTag.textContent = projectsState.projects[conversation.projectId].name;
      name.appendChild(projectTag);
    }

    const preview = document.createElement('p');
    preview.className = 'conversation-preview';
    const lastMessage = conversation.messages[conversation.messages.length - 1];
    preview.textContent = lastMessage ? lastMessage.content.slice(0, 60) : 'Sin mensajes aún';

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
  persistState();
}

function createConversation() {
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
            <span class="thinking-icon">⚛</span>
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
          <span class="thinking-icon">⚛</span>
          <span class="thinking-title thinking-active">Pensando</span>
        </div>
        <div class="thinking-loading">
          Analizando la pregunta<div class="thinking-dots"><span></span><span></span><span></span></div>
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
    content += parseMarkdown(text);
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
        {left: '$$', right: '$$', display: true},
        {left: '$', right: '$', display: false}
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
      copyContainer.appendChild(timeElement);
      bubble.appendChild(copyContainer);
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
      if (now - lastScrollTime >= SCROLL_INTERVAL) {
        scrollChatToBottom();
        lastScrollTime = now;
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
  }
}

async function streamAssistantResponse(conversation, payloadMessages) {
  if (!state.currentModel) {
    throw new Error('Selecciona un modelo antes de enviar un mensaje.');
  }

  const assistantMessage = createMessage('assistant', '');
  assistantMessage.thinking = '';
  assistantMessage.thinkingDuration = 0;
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
  // Añadir margen para la respuesta (al menos 2000 tokens extra)
  const recommendedContext = Math.max(4096, estimatedTokens + 2000);
  // Limitar a un máximo razonable
  const numCtx = Math.min(recommendedContext, 32768);

  const body = {
    model: state.currentModel,
    stream: true,
    messages: payloadMessages,
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
              pendingUpdate = true;
              
              // Programar actualización de forma asíncrona
              scheduleUpdate();
            }
          }

          if (parsed.error) {
            throw new Error(parsed.error);
          }

          if (parsed.done) {
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
            const responseTime = (Date.now() - startTime) / 1000;
            trackModelUsage(state.currentModel);
            trackDailyMessage();
            trackResponseTime(responseTime);
            
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
    
    // Solo actualizar si fue cancelado y aún no se ha actualizado el bubble
    if (wasCancelled) {
      // Verificar si el bubble ya fue actualizado en stopStream
      const currentContent = bubble?.textContent || '';
      if (!currentContent.includes('cancelada')) {
        assistantMessage.content += (assistantMessage.content ? '\n\n' : '') + '⚠️ Respuesta cancelada por el usuario.';
        updateAssistantBubble(bubble, assistantMessage.content, null);
        persistState();
      }
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
  
  if (isFirstMessage || shouldIncludeProjectContext) {
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

async function handleSubmit(event) {
  event.preventDefault();
  if (state.loading) return;

  const isEmptyState = emptyState?.style.display !== 'none';
  const activeInput = isEmptyState ? promptInput : promptInputInline;
  const prompt = activeInput?.value.trim();
  if (!prompt) return;

  const conversation = state.conversations[state.activeId];
  if (!conversation) return;

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
  
  // Si es el primer mensaje O hay un proyecto activo, construir el mensaje del sistema
  if (isFirstMessage || shouldIncludeProjectContext) {
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
    if (systemContent || styleInstructions || instructions) {
      let finalContent = systemContent;
      
      if (styleInstructions) {
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
    return await extractTextFromPDF(file, null); // Sin callback de progreso aquí
  } else {
    return await readFileAsText(file);
  }
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
        alert(`El archivo ${file.name} es demasiado grande (${formatFileSize(file.size)}). El tamaño máximo es ${formatFileSize(MAX_FILE_SIZE)}.`);
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
              alert(`El PDF ${file.name} tiene demasiadas páginas (${pdf.numPages}). El máximo permitido es ${MAX_PDF_PAGES} páginas.`);
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
  'photo/Canoe on the Epte-2HF5cCC7u0ju6eRcwdwr-hd-jpg.jpg'
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
3. Cada dato debe ser UNA FRASE CORTA en tercera persona (ej: "Estudia medicina", "Vive en Madrid")
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
  const subtitleElement = document.getElementById('greeting-subtitle');
  
  if (!greetingElement || !subtitleElement) return;
  
  const { greeting, subtitle } = getGreetingMessage();
  const userName = getUserName();
  const firstName = userName.split(' ')[0];
  
  greetingElement.innerHTML = `${greeting}, <span class="user-name">${firstName}</span>`;
  subtitleElement.textContent = subtitle;
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
  
  // Precargar todas las imágenes de fondo en segundo plano
  // Usar requestIdleCallback si está disponible, sino setTimeout
  if (window.requestIdleCallback) {
    requestIdleCallback(() => {
      preloadBackgroundImages();
    }, { timeout: 2000 });
  } else {
    setTimeout(() => {
      preloadBackgroundImages();
    }, 1000);
  }
  
  // Verificar cada minuto si hay que cambiar el fondo (a las 00:00)
  setInterval(() => {
    if (shouldChangeBackground()) {
      setBackgroundImage();
    }
    updateGreeting(); // Actualizar saludo cada minuto por si cambia la hora
  }, 60000); // Cada minuto
}

function updateUserNameDisplay() {
  const userName = getUserName();
  const userNameDisplay = document.getElementById('user-name-display');
  if (userNameDisplay) {
    userNameDisplay.textContent = userName;
  }
  
  // Actualizar también en el saludo
  const greetingElement = document.getElementById('greeting-text');
  if (greetingElement) {
    const firstName = userName.split(' ')[0];
    const { greeting } = getGreetingMessage();
    greetingElement.innerHTML = `${greeting}, <span class="user-name">${firstName}</span>`;
  }
  
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
  window.renderMemoriesList = function() {
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
      if (confirm('¿Estás seguro de que quieres borrar todos los recuerdos?')) {
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
});

// ========================================
// Sistema de Proyectos
// ========================================
const PROJECTS_STORAGE_KEY = 'ollama-web-projects';

// Estado de proyectos
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
      isImage: f.isImage || false
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
      isImage: f.isImage || false
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
    title: `${project.name} - Nueva conversación`,
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
    context += 'IMPORTANTE: Debes seguir las instrucciones del proyecto y USAR el contenido de los documentos proporcionados para responder las preguntas del usuario. Si el usuario pregunta sobre los documentos, resume o explica lo que contienen.\n';
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
  } else {
    // Ocultar ambos badges
    if (badge) badge.style.display = 'none';
    if (badgeEmpty) badgeEmpty.style.display = 'none';
  }
}

function renderProjectsList() {
  const listElement = document.getElementById('projects-list');
  if (!listElement) return;
  
  const projects = Object.values(projectsState.projects);
  
  if (projects.length === 0) {
    listElement.innerHTML = `
      <li class="projects-empty">
        No hay proyectos aún.<br>
        <span style="font-size: 11px; opacity: 0.7;">Crea uno para organizar tus chats</span>
      </li>
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
      <li class="project-item ${isActive ? 'active' : ''}" data-project-id="${project.id}">
        <div class="project-item-icon">📂</div>
        <div class="project-item-info">
          <p class="project-item-name">${escapeHtml(project.name || 'Sin nombre')}</p>
          <p class="project-item-meta">${fileCount} archivo${fileCount !== 1 ? 's' : ''} · ${convCount} chat${convCount !== 1 ? 's' : ''}</p>
        </div>
        <div class="project-item-actions">
          <button class="project-action-btn edit" title="Editar proyecto" data-action="edit">✎</button>
          <button class="project-action-btn delete" title="Eliminar proyecto" data-action="delete">🗑</button>
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
  setTimeout(() => nameInput.focus(), 100);
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
        alert(`El archivo ${file.name} es demasiado grande. El tamaño máximo es 50MB.`);
        continue;
      }
      
      const isPDF = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      console.log(`📂 Proyecto - Procesando archivo: ${file.name} (${isPDF ? 'PDF' : 'texto'})`);
      
      const content = await readFileContent(file);
      const isImage = isImageFile(file);
      
      // Log de depuración para verificar el contenido extraído
      console.log(`📂 Proyecto - Archivo procesado: ${file.name}`);
      console.log(`   - Tipo: ${isImage ? 'Imagen' : (isPDF ? 'PDF' : 'Texto')}`);
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
    } catch (error) {
      console.error(`Error al leer el archivo ${file.name}:`, error);
      alert(`Error al leer el archivo ${file.name}: ${error.message}`);
    }
  }
  
  renderProjectFiles();
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
    return `<span class="research-indicator" title="Investigación en progreso: ${deepResearchProgressState.progress}%">🔬</span>`;
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
      input.placeholder = '🔬 Investigación en progreso... Solo lectura';
      input.disabled = true;
      input.classList.add('research-locked');
    }
  });
  
  sendButtons.forEach(btn => {
    if (btn) {
      btn.disabled = true;
      btn.classList.add('research-locked');
    }
  });
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
      btn.disabled = false;
      btn.classList.remove('research-locked');
    }
  });
}

function toggleDeepResearch(button) {
  deepResearchMode = !deepResearchMode;
  
  // Actualizar ambos botones
  const buttons = document.querySelectorAll('.deep-research-btn');
  buttons.forEach(btn => {
    if (deepResearchMode) {
      btn.classList.add('active');
      btn.title = 'Deep Research activado - Haz clic para desactivar';
    } else {
      btn.classList.remove('active');
      btn.title = 'Activar Deep Research - Investigación profunda con múltiples iteraciones';
    }
  });
  
  console.log(`🔬 Deep Research: ${deepResearchMode ? 'activado' : 'desactivado'}`);
}

function initDeepResearch() {
  const deepResearchBtn = document.getElementById('deep-research-btn');
  const deepResearchBtnInline = document.getElementById('deep-research-btn-inline');
  
  deepResearchBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    toggleDeepResearch(deepResearchBtn);
  });
  
  deepResearchBtnInline?.addEventListener('click', (e) => {
    e.preventDefault();
    toggleDeepResearch(deepResearchBtnInline);
  });
}

// Crear elemento de progreso de Deep Research
function createDeepResearchProgressElement() {
  const container = document.createElement('div');
  container.className = 'deep-research-container';
  container.innerHTML = `
    <div class="deep-research-header">
      <div class="deep-research-title">
        <svg class="deep-research-title-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/>
          <path d="M11 8v6M8 11h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <path d="M16 16l4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        Deep Research
      </div>
      <div class="deep-research-header-right">
        <span class="deep-research-status">Iniciando investigación...</span>
      </div>
    </div>
    <div class="deep-research-progress">
      <div class="deep-research-progress-bar">
        <div class="deep-research-progress-fill" style="width: 0%"></div>
      </div>
      <span class="deep-research-progress-percent">0%</span>
    </div>
    <div class="deep-research-steps"></div>
    <div class="deep-research-findings" style="display: none;">
      <div class="deep-research-findings-title">
        <span>📊</span> Hallazgos clave
      </div>
      <div class="deep-research-findings-list"></div>
    </div>
  `;
  return container;
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
    indicator.textContent = '🔬';
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
          <span class="research-banner-icon">🔬</span>
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
    <div class="deep-research-step-indicator">${isCompleted ? '✓' : step.number}</div>
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
      if (indicator) indicator.textContent = '✓';
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
    findingElement.textContent = finding;
    findingsList.appendChild(findingElement);
  }
}

// Generar plan de investigación usando el modelo
async function generateResearchPlan(userQuery, signal = null) {
  console.log('🔬 Generando plan de investigación para:', userQuery);
  
  const planPrompt = `Eres un asistente de investigación experto. El usuario quiere investigar: "${userQuery}"

Tu tarea es crear un plan de investigación estructurado. Responde ÚNICAMENTE con un JSON válido (sin markdown, sin explicaciones) con esta estructura exacta:
{
  "mainQuestion": "La pregunta principal reformulada de forma clara",
  "subQuestions": [
    {
      "id": "q1",
      "question": "Primera sub-pregunta específica",
      "purpose": "Por qué esta pregunta es importante"
    },
    {
      "id": "q2", 
      "question": "Segunda sub-pregunta específica",
      "purpose": "Por qué esta pregunta es importante"
    },
    {
      "id": "q3",
      "question": "Tercera sub-pregunta específica",
      "purpose": "Por qué esta pregunta es importante"
    }
  ],
  "approach": "Breve descripción del enfoque de investigación"
}

Genera exactamente 3 sub-preguntas que cubran los aspectos más importantes del tema.`;

  try {
    const response = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: state.currentModel,
        stream: false,
        messages: [{ role: 'user', content: planPrompt }],
        options: { temperature: 0.3 }
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
      return plan;
    }
    
    throw new Error('No se pudo parsear el plan');
  } catch (error) {
    console.error('Error generando plan:', error);
    // Plan de fallback
    return {
      mainQuestion: userQuery,
      subQuestions: [
        { id: 'q1', question: `¿Cuáles son los conceptos fundamentales de ${userQuery}?`, purpose: 'Establecer base' },
        { id: 'q2', question: `¿Cuáles son las aplicaciones prácticas o ejemplos de ${userQuery}?`, purpose: 'Aplicación práctica' },
        { id: 'q3', question: `¿Cuáles son los desafíos o limitaciones de ${userQuery}?`, purpose: 'Análisis crítico' }
      ],
      approach: 'Investigación estructurada en tres fases'
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
  
  const synthesisPrompt = `Eres un experto sintetizando investigaciones. Se realizó una investigación profunda sobre: "${originalQuery}"

Hallazgos de la investigación:
${findingsSummary}

Tu tarea es crear un INFORME FINAL COMPLETO que:
1. Tenga una introducción clara del tema
2. Presente los hallazgos más importantes de forma estructurada
3. Incluya una sección de conclusiones
4. Destaque los puntos más relevantes

Usa formato Markdown con encabezados, listas y énfasis donde sea apropiado.
El informe debe ser comprensivo pero conciso.`;

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

// Función principal de Deep Research
async function executeDeepResearch(userQuery, conversation) {
  console.log('🔬 Iniciando Deep Research:', userQuery);
  
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
  const userMessage = createMessage('user', `🔬 **Deep Research**: ${userQuery}`);
  conversation.messages.push(userMessage);
  touchConversation(conversation.id);
  
  showChatState();
  appendMessageElement(userMessage);
  updateConversationTitleFromContent(conversation);
  
  // Crear mensaje del asistente con el contenedor de progreso
  const assistantMessage = createMessage('assistant', '');
  assistantMessage.isDeepResearchInProgress = true; // Marcar como Deep Research activo
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
            Deep Research • ${findings.length} temas investigados
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
      
      const timeElement = document.createElement('span');
      timeElement.className = 'message-time';
      timeElement.textContent = formatTime(Date.now());
      
      copyContainer.appendChild(copyButton);
      copyContainer.appendChild(timeElement);
      bubble.appendChild(copyContainer);
      
      // Renderizar matemáticas
      if (typeof renderMathInElement !== 'undefined') {
        renderMathInElement(bubble, {
          delimiters: [
            {left: '$$', right: '$$', display: true},
            {left: '$', right: '$', display: false}
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

// Modificar el handleSubmit original para soportar Deep Research
const originalHandleSubmit = handleSubmit;

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
      await executeDeepResearch(prompt, conversation);
    } catch (error) {
      console.error('Error en Deep Research:', error);
    } finally {
      state.loading = false;
    }
    
    return;
  }
  
  // Si no, usar el flujo normal
  return originalHandleSubmit.call(this, event);
}

// Sobrescribir handleSubmit globalmente
handleSubmit = handleSubmitWithDeepResearch;

