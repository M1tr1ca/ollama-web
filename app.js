const API_BASE = 'http://localhost:11434';
const STORAGE_KEY = 'ollama-web-state-v1';
const DEFAULT_TITLE = 'Nueva conversación';

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

const state = {
  conversations: {},
  order: [],
  activeId: null,
  currentModel: null,
  loading: false,
};

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

function createMessage(role, content = '') {
  return {
    id: generateId('msg'),
    role,
    content,
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

function parseMarkdown(text) {
  if (!text) return '';
  
  let html = text;
  
  // Proteger fórmulas matemáticas antes de procesar
  const mathBlocks = [];
  const mathInline = [];
  const codeBlocks = [];
  
  // Guardar code blocks primero para no procesarlos
  html = html.replace(/```([\s\S]*?)```/g, (match, code) => {
    codeBlocks.push(code);
    return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
  });
  
  // Guardar bloques de matemáticas $$...$$
  html = html.replace(/\$\$([\s\S]+?)\$\$/g, (match, formula) => {
    mathBlocks.push(formula.trim());
    return `__MATH_BLOCK_${mathBlocks.length - 1}__`;
  });
  
  // Guardar matemáticas inline $...$
  html = html.replace(/\$([^\$\n]+?)\$/g, (match, formula) => {
    mathInline.push(formula.trim());
    return `__MATH_INLINE_${mathInline.length - 1}__`;
  });
  
  // Escapar HTML
  html = html.replace(/&/g, '&amp;')
             .replace(/</g, '&lt;')
             .replace(/>/g, '&gt;');
  
  // Headers (###, ##, #)
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
  
  // Bold (**text** o __text__)
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
  
  // Italic (*text* o _text_)
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');
  
  // Inline code (`code`)
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  
  // Links [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  
  // Line breaks
  html = html.replace(/\n/g, '<br>');
  
  // Lists (-, *, +)
  html = html.replace(/^[\-\*\+] (.+)$/gim, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
  
  // Restaurar code blocks
  html = html.replace(/__CODE_BLOCK_(\d+)__/g, (match, index) => {
    const code = codeBlocks[parseInt(index)];
    return `<pre><code>${code}</code></pre>`;
  });
  
  // Restaurar fórmulas matemáticas en bloques
  html = html.replace(/__MATH_BLOCK_(\d+)__/g, (match, index) => {
    let formula = mathBlocks[parseInt(index)];
    // Convertir funciones comunes si no tienen backslash
    formula = formula.replace(/\bsqrt\[/g, '\\sqrt[')
                     .replace(/\bsqrt\(/g, '\\sqrt{')
                     .replace(/\bfrac\(/g, '\\frac{')
                     .replace(/\bsum\b/g, '\\sum')
                     .replace(/\bint\b/g, '\\int')
                     .replace(/\blim\b/g, '\\lim')
                     .replace(/\binfty\b/g, '\\infty');
    return `<span class="math-block">$$${formula}$$</span>`;
  });
  
  // Restaurar fórmulas matemáticas inline
  html = html.replace(/__MATH_INLINE_(\d+)__/g, (match, index) => {
    let formula = mathInline[parseInt(index)];
    // Convertir funciones comunes si no tienen backslash
    formula = formula.replace(/\bsqrt\[/g, '\\sqrt[')
                     .replace(/\bsqrt\(/g, '\\sqrt{')
                     .replace(/\bfrac\(/g, '\\frac{')
                     .replace(/\bsum\b/g, '\\sum')
                     .replace(/\bint\b/g, '\\int')
                     .replace(/\blim\b/g, '\\lim')
                     .replace(/\binfty\b/g, '\\infty');
    return `<span class="math-inline">$${formula}$</span>`;
  });
  
  return html;
}

function appendMessageElement(message) {
  const li = document.createElement('li');
  li.className = `message ${message.role}`;

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = message.role === 'user' ? 'Tú' : 'AI';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  
  let content = '';
  
  // Agregar bloque de pensamiento si existe
  if (message.thinking && message.role === 'assistant') {
    content += createThinkingBlock(message.thinking, message.thinkingDuration, false);
  }
  
  // Agregar el contenido del mensaje
  if (message.content) {
    content += parseMarkdown(message.content);
  }
  
  bubble.innerHTML = content;
  
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
}

function showEmptyState() {
  if (emptyState) emptyState.style.display = 'flex';
  if (chatState) chatState.style.display = 'none';
}

function showChatState() {
  if (emptyState) emptyState.style.display = 'none';
  if (chatState) chatState.style.display = 'flex';
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

    const textBlock = document.createElement('div');
    textBlock.className = 'conversation-text';

    const name = document.createElement('p');
    name.className = 'conversation-name';
    name.textContent = conversation.title ?? DEFAULT_TITLE;

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
  state.activeId = id;
  renderConversationList();
  renderActiveConversation();
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
  };
  state.conversations[id] = conversation;
  touchConversation(id);
  setActiveConversation(id);
  if (promptInput) promptInput.focus();
}

function handleRenameConversation(id) {
  const conversation = state.conversations[id];
  if (!conversation) return;
  const newTitle = window.prompt('Nombre de la conversación', conversation.title ?? DEFAULT_TITLE);
  if (!newTitle) return;
  conversation.title = newTitle.trim() || DEFAULT_TITLE;
  touchConversation(id);
  renderConversationList();
  if (id === state.activeId) renderActiveConversation();
  persistState();
}

function handleDeleteConversation(id) {
  if (!state.conversations[id]) return;
  const confirmDelete = window.confirm('¿Eliminar esta conversación? Esta acción no se puede deshacer.');
  if (!confirmDelete) return;
  delete state.conversations[id];
  state.order = state.order.filter((convId) => convId !== id);
  if (state.activeId === id) {
    state.activeId = state.order[0] ?? null;
  }
  if (!state.activeId) {
    createConversation();
  } else {
    renderConversationList();
    renderActiveConversation();
    persistState();
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
    return `
      <div class="thinking-block">
        <div class="thinking-header">
          <span class="thinking-icon">⚛</span>
          <span class="thinking-title">Pensando...</span>
        </div>
        <div class="thinking-loading">
          Analizando la pregunta<div class="thinking-dots"><span></span><span></span><span></span></div>
        </div>
      </div>
    `;
  }
  
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

function updateAssistantBubble(bubble, text, thinkingData = null) {
  if (!bubble) return;
  
  let content = '';
  
  // Agregar bloque de pensamiento si existe
  if (thinkingData) {
    if (thinkingData.isLoading) {
      content += createThinkingBlock('', null, true);
    } else if (thinkingData.thinking) {
      content += createThinkingBlock(thinkingData.thinking, thinkingData.duration, false);
    }
  }
  
  // Agregar el texto de la respuesta
  if (text) {
    content += parseMarkdown(text);
  }
  
  bubble.innerHTML = content;
  
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
  
  scrollChatToBottom();
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
        let sizeInfo = '';
        
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
        
        // Agregar tamaño de parámetros si está disponible
        if (model.details?.parameter_size) {
          const size = model.details.parameter_size;
          // Convertir tamaños a formato legible
          if (size.includes('B')) {
            sizeInfo = ` • ${size}`;
          } else if (size.includes('M')) {
            sizeInfo = ` • ${size}`;
          }
        } else if (model.size) {
          // Si tiene tamaño en bytes, convertir
          const gb = (model.size / (1024 ** 3)).toFixed(1);
          sizeInfo = ` • ${gb} GB`;
        }
        
        option.textContent = displayName + sizeInfo;
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

  const body = {
    model: state.currentModel,
    stream: true,
    messages: payloadMessages,
  };

  const response = await fetch(`${API_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok || !response.body) {
    throw new Error(`Error al consultar el modelo: ${response.statusText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let isFirstChunk = true;
  let thinkingComplete = false;

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
          if (parsed.thinking || parsed.reasoning || parsed.thought) {
            const thinkingText = parsed.thinking || parsed.reasoning || parsed.thought;
            assistantMessage.thinking += thinkingText;
            const duration = ((Date.now() - startTime) / 1000).toFixed(0);
            assistantMessage.thinkingDuration = duration;
            updateAssistantBubble(bubble, assistantMessage.content, {
              thinking: assistantMessage.thinking,
              duration: duration
            });
            thinkingComplete = true;
            persistState();
          }

          if (parsed.message?.content) {
            const contentChunk = parsed.message.content;
            
            // Detectar si el contenido contiene marcadores de razonamiento
            // Algunos modelos incluyen el razonamiento en el contenido con tags especiales
            const thinkingMatch = contentChunk.match(/<think>([\s\S]*?)<\/think>/);
            if (thinkingMatch && thinkingMatch[1]) {
              assistantMessage.thinking += thinkingMatch[1];
              const duration = ((Date.now() - startTime) / 1000).toFixed(0);
              assistantMessage.thinkingDuration = duration;
              thinkingComplete = true;
              // Remover el tag de pensamiento del contenido
              const cleanContent = contentChunk.replace(/<think>[\s\S]*?<\/think>/, '');
              if (cleanContent.trim()) {
                assistantMessage.content += cleanContent;
              }
            } else {
              // Si es el primer chunk y no hay pensamiento explícito, registrar el tiempo de primera respuesta
              if (isFirstChunk && !thinkingComplete) {
                const duration = ((Date.now() - startTime) / 1000).toFixed(0);
                assistantMessage.thinkingDuration = duration;
                
                // Solo mostrar el indicador de pensamiento si tomó más de 1 segundo
                if (duration > 1) {
                  assistantMessage.thinking = `Procesó la solicitud en ${duration} segundos antes de responder...`;
                }
                
                isFirstChunk = false;
              }
              
              assistantMessage.content += contentChunk;
            }
            
            // Actualizar con pensamiento si existe
            const thinkingData = assistantMessage.thinking ? {
              thinking: assistantMessage.thinking,
              duration: assistantMessage.thinkingDuration
            } : null;
            
            updateAssistantBubble(bubble, assistantMessage.content, thinkingData);
            persistState();
          }

          if (parsed.error) {
            throw new Error(parsed.error);
          }

          if (parsed.done) {
            conversation.updatedAt = Date.now();
            persistState();
            renderConversationList();
            return;
          }
        } catch (parseError) {
          console.warn('No se pudo analizar un fragmento del stream', parseError, line);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
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

  const userMessage = createMessage('user', prompt);
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

  const payloadMessages = conversation.messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));

  try {
    await streamAssistantResponse(conversation, payloadMessages);
  } catch (error) {
    console.error(error);
    const assistantMessage = conversation.messages[conversation.messages.length - 1];
    if (assistantMessage?.role === 'assistant') {
      assistantMessage.content = `⚠️ ${error.message}`;
      const lastBubble = chatList?.lastElementChild?.querySelector('.message-bubble');
      updateAssistantBubble(lastBubble, assistantMessage.content);
      persistState();
    }
  } finally {
    state.loading = false;
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

function init() {
  if (!chatList) return;

  loadState();
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
}

document.addEventListener('DOMContentLoaded', init);

// ========================================================================
// Sistema de fondos artísticos - Cambio diario
// ========================================================================

const artisticBackgrounds = [
  './Photos/wallpaper1.jpg',
  './Photos/wallpaper2.jpg',
  './Photos/El Puente Japonés (El Estanque de Nenúfares)-4fu0WvfYzycOaMPCIv8h-4k.jpg',
  './Photos/Juan les Pins-Bm2sDPUlIC9RaBO64j4R-4k.jpg',
  './Photos/Casa de pescador en Petit Ailly-81LyN1qySPHOjUlgb1BE-4k.jpg',
  './Photos/Álamos en el Epte-6mRZ3ln8QjrokwBNAkwz-4k.jpg',
  './Photos/Marino-EJe2s7X77M2ImT8rEVJx-hd-png.png'
];

function getDailyBackgroundIndex() {
  // Obtener el día del año (1-365/366)
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const diff = now - start;
  const oneDay = 1000 * 60 * 60 * 24;
  const dayOfYear = Math.floor(diff / oneDay);
  
  // Usar el día del año para seleccionar la imagen
  return dayOfYear % artisticBackgrounds.length;
}

function setDailyBackground() {
  const body = document.body;
  const dailyIndex = getDailyBackgroundIndex();
  const dailyImage = artisticBackgrounds[dailyIndex];
  
  body.style.setProperty('--background-image', `url('${dailyImage}')`);
  
  console.log(`🎨 Fondo artístico del día: ${dailyImage.split('/').pop()}`);
}

// Establecer el fondo del día al cargar
setDailyBackground();

// Verificar cambio de día cada hora (por si la página queda abierta)
setInterval(() => {
  setDailyBackground();
}, 1000 * 60 * 60); // Cada hora

// ========================================================================
// Sistema de alternado de barra lateral
// ========================================================================

const toggleSidebarButton = document.getElementById('toggle-sidebar');
const closeSidebarButton = document.getElementById('close-sidebar');
const layoutContainer = document.getElementById('app');
const SIDEBAR_STATE_KEY = 'ollama-web-sidebar-visible';

function loadSidebarState() {
  if (!hasLocalStorage) return true;
  try {
    const savedState = window.localStorage.getItem(SIDEBAR_STATE_KEY);
    return savedState === null ? true : savedState === 'true';
  } catch (error) {
    return true;
  }
}

function saveSidebarState(isVisible) {
  if (!hasLocalStorage) return;
  try {
    window.localStorage.setItem(SIDEBAR_STATE_KEY, isVisible.toString());
  } catch (error) {
    console.warn('No se pudo guardar el estado de la barra lateral', error);
  }
}

function toggleSidebar() {
  const isHidden = layoutContainer.classList.toggle('sidebar-hidden');
  saveSidebarState(!isHidden);
}

// Inicializar el estado de la barra lateral
function initSidebar() {
  const isVisible = loadSidebarState();
  if (!isVisible) {
    layoutContainer.classList.add('sidebar-hidden');
  }
}

// Agregar event listeners a ambos botones
toggleSidebarButton?.addEventListener('click', toggleSidebar);
closeSidebarButton?.addEventListener('click', toggleSidebar);

// Inicializar al cargar
initSidebar();

