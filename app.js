const API_BASE = 'http://localhost:11434';
const STORAGE_KEY = 'ollama-web-state-v1';
const DEFAULT_TITLE = 'Nueva conversación';
const BACKGROUND_STORAGE_KEY = 'ollama-web-background-date';

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
  
  let html = text;
  
  // Proteger fórmulas matemáticas antes de procesar
  const mathBlocks = [];
  const mathInline = [];
  const codeBlocks = [];
  
  // Detectar y convertir marcadores CODEBLOCK0, CODEBLOCK1, etc. en bloques de código
  // Procesar cada CODEBLOCK buscando código asociado después del marcador
  
  // Primero encontrar todos los marcadores CODEBLOCK con sus posiciones
  const codeBlockMatches = [];
  let regexMatch;
  const codeBlockRegex = /CODEBLOCK(\d+)/g;
  while ((regexMatch = codeBlockRegex.exec(html)) !== null) {
    codeBlockMatches.push({
      fullMatch: regexMatch[0],
      number: regexMatch[1],
      index: regexMatch.index
    });
  }
  
  // Procesar de atrás hacia adelante para no afectar los índices
  for (let i = codeBlockMatches.length - 1; i >= 0; i--) {
    const match = codeBlockMatches[i];
    const startIndex = match.index;
    const endIndex = i < codeBlockMatches.length - 1 
      ? codeBlockMatches[i + 1].index 
      : html.length;
    
    // Buscar código después del marcador hasta el siguiente CODEBLOCK o fin
    const textAfter = html.substring(startIndex + match.fullMatch.length, endIndex);
    
    // Buscar bloques ``` existentes primero
    const existingCodeBlock = textAfter.match(/```[\s\S]*?```/);
    if (existingCodeBlock) {
      const code = existingCodeBlock[0].replace(/```/g, '').trim();
      if (code) {
        html = html.substring(0, startIndex) + 
               `\`\`\`\n${code}\n\`\`\`` + 
               html.substring(startIndex + match.fullMatch.length);
        continue;
      }
    }
    
    // Si no hay bloque ```, buscar código en las líneas siguientes
    const lines = textAfter.split('\n');
    const codeLines = [];
    let collectingCode = false;
    let consecutiveEmpty = 0;
    
    for (let j = 0; j < lines.length && j < 100; j++) { // Aumentar límite a 100 líneas
      const line = lines[j];
      const trimmedLine = line.trim();
      
      if (trimmedLine === '') {
        consecutiveEmpty++;
        if (collectingCode && consecutiveEmpty < 3) { // Permitir hasta 3 líneas vacías consecutivas
          codeLines.push(line);
        }
        continue;
      }
      
      consecutiveEmpty = 0;
      
      // Detectar si es claramente texto explicativo (más estricto)
      const isExplanatoryText = 
        trimmedLine.match(/^\d+\.\s+[A-Z][a-z]+/) || // "1. Explicación" con minúsculas después
        (trimmedLine.match(/^[A-Z][a-z]+\s*:$/) && trimmedLine.length < 30) || // "Explicación:" corto
        (trimmedLine.length > 80 && trimmedLine.match(/^[A-Z]/) && 
         !trimmedLine.includes('{') && !trimmedLine.includes('(') && 
         !trimmedLine.includes(';') && !trimmedLine.includes('=') &&
         !trimmedLine.includes('#') && !trimmedLine.includes('//') &&
         !trimmedLine.includes('*') && !trimmedLine.includes('['));
      
      // Si encontramos texto explicativo claro después de código, detener
      if (collectingCode && isExplanatoryText) {
        break;
      }
      
      // Detectar si parece código (tiene caracteres comunes de programación)
      const looksLikeCode = 
        trimmedLine.includes('{') || trimmedLine.includes('}') ||
        trimmedLine.includes('(') || trimmedLine.includes(')') ||
        trimmedLine.includes(';') || trimmedLine.includes('=') ||
        trimmedLine.includes('#') || trimmedLine.includes('//') ||
        trimmedLine.includes('*') || trimmedLine.includes('[') ||
        trimmedLine.includes('function') || trimmedLine.includes('const') ||
        trimmedLine.includes('var') || trimmedLine.includes('let') ||
        trimmedLine.includes('return') || trimmedLine.includes('if') ||
        trimmedLine.includes('for') || trimmedLine.includes('while') ||
        trimmedLine.match(/^[a-z_][a-zA-Z0-9_]*\s*[=\(:]/) || // Variables/funciones
        (line.match(/^\s{2,}/) && trimmedLine.length > 0); // Líneas con indentación
      
      // Si parece código o no es claramente texto explicativo, incluirlo
      if (looksLikeCode || !isExplanatoryText) {
        collectingCode = true;
        codeLines.push(line);
      }
    }
    
    const codeContent = codeLines.join('\n').trim();
    if (codeContent && codeContent.length > 0) {
      html = html.substring(0, startIndex) + 
             `\`\`\`\n${codeContent}\n\`\`\`` + 
             html.substring(startIndex + match.fullMatch.length);
    } else {
      // Si no hay código, eliminar solo el marcador CODEBLOCK
      html = html.substring(0, startIndex) + html.substring(startIndex + match.fullMatch.length);
    }
  }
  
  // Guardar code blocks primero para no procesarlos
  html = html.replace(/```([\s\S]*?)```/g, (match, code) => {
    codeBlocks.push(code);
    return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
  });
  
  // Detectar y procesar patrones matemáticos comunes antes de proteger fórmulas explícitas
  // Convertir símbolos matemáticos comunes a formato LaTeX
  html = html.replace(/∫/g, '\\int')
              .replace(/∑/g, '\\sum')
              .replace(/∏/g, '\\prod')
              .replace(/√/g, '\\sqrt')
              .replace(/π/g, '\\pi')
              .replace(/α/g, '\\alpha')
              .replace(/β/g, '\\beta')
              .replace(/γ/g, '\\gamma')
              .replace(/δ/g, '\\delta')
              .replace(/θ/g, '\\theta')
              .replace(/λ/g, '\\lambda')
              .replace(/μ/g, '\\mu')
              .replace(/σ/g, '\\sigma')
              .replace(/φ/g, '\\phi')
              .replace(/ω/g, '\\omega')
              .replace(/∞/g, '\\infty')
              .replace(/≤/g, '\\leq')
              .replace(/≥/g, '\\geq')
              .replace(/≠/g, '\\neq')
              .replace(/≈/g, '\\approx')
              .replace(/±/g, '\\pm')
              .replace(/×/g, '\\times')
              .replace(/÷/g, '\\div')
              .replace(/∂/g, '\\partial')
              .replace(/∇/g, '\\nabla')
              .replace(/∈/g, '\\in')
              .replace(/∉/g, '\\notin')
              .replace(/⊂/g, '\\subset')
              .replace(/⊃/g, '\\supset')
              .replace(/∩/g, '\\cap')
              .replace(/∪/g, '\\cup')
              .replace(/∅/g, '\\emptyset')
              .replace(/∀/g, '\\forall')
              .replace(/∃/g, '\\exists')
              .replace(/→/g, '\\rightarrow')
              .replace(/←/g, '\\leftarrow')
              .replace(/↔/g, '\\Leftrightarrow')
              .replace(/⇒/g, '\\Rightarrow')
              .replace(/⇐/g, '\\Leftarrow');
  
  // Detectar fórmulas matemáticas en formato común (ej: ∫_a^b f(x) dx)
  // Patrones como: ∫_a^b, ∫^b_a, sum_{i=1}^n, etc.
  html = html.replace(/(\\int|\\sum|\\prod|\\lim|\\max|\\min|\\sup|\\inf)\s*_([^{]+?)\^([^{]+?)(\s|$|\\|,|;|\))/g, (match, func, sub, sup, after) => {
    const index = mathInline.length;
    mathInline.push(`${func}_{${sub}}^{${sup}}`);
    return `__MATH_INLINE_${index}__${after}`;
  });
  
  // Detectar expresiones matemáticas comunes que deberían ser inline
  // Patrones como: x^2, x_1, f(x), etc. pero solo si están claramente marcadas
  // Esto es más conservador para no romper texto normal
  
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
  
  // Detectar placeholders MATHBLOCK y MATHINLINE y convertirlos a fórmulas vacías o marcadores
  // Estos placeholders indican que debería haber una fórmula matemática aquí
  // Se procesan ANTES de proteger fórmulas explícitas para que no interfieran
  html = html.replace(/MATHBLOCK(\d+)/g, (match, num) => {
    const index = mathBlocks.length;
    mathBlocks.push(''); // Fórmula vacía - se mostrará un marcador
    return `__MATH_BLOCK_${index}__`;
  });
  
  html = html.replace(/MATHINLINE(\d+)/g, (match, num) => {
    const index = mathInline.length;
    mathInline.push(''); // Fórmula vacía - se mostrará un marcador
    return `__MATH_INLINE_${index}__`;
  });
  
  // Escapar HTML
  html = html.replace(/&/g, '&amp;')
             .replace(/</g, '&lt;')
             .replace(/>/g, '&gt;');
  
  // Headers (####, ###, ##, #) - procesar en orden de más específico a menos específico
  html = html.replace(/^#### (.*$)/gim, '<h4>$1</h4>');
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
  
  // Separadores horizontales (--- o ***) - debe ir antes de convertir saltos de línea
  html = html.replace(/^(\s*)(\*{3,}|-{3,})(\s*)$/gim, '<hr>');
  
  // Procesar tablas ANTES de convertir saltos de línea
  // Las tablas en markdown tienen el formato: | col1 | col2 |\n|------|------|\n| data1 | data2 |
  const tablePlaceholders = [];
  const linesForTables = html.split('\n');
  const processedLinesForTables = [];
  let inTable = false;
  let tableRows = [];
  
  for (let i = 0; i < linesForTables.length; i++) {
    const line = linesForTables[i];
    const isTableRow = line.trim().startsWith('|') && line.trim().endsWith('|');
    const isTableSeparator = isTableRow && /^[\s\|:\-]+$/.test(line.replace(/\|/g, ''));
    
    if (isTableRow && !isTableSeparator) {
      // Es una fila de tabla (header o data)
      if (!inTable) {
        inTable = true;
        tableRows = [];
      }
      tableRows.push(line);
    } else if (isTableSeparator && inTable) {
      // Es el separador, lo ignoramos pero mantenemos la tabla abierta
      continue;
    } else {
      // No es parte de una tabla
      if (inTable && tableRows.length > 0) {
        // Procesar la tabla acumulada
        const tableIndex = tablePlaceholders.length;
        let tableHtml = '<table class="markdown-table">';
        
        // Primera fila es el header
        const headerCells = tableRows[0].split('|').map(cell => cell.trim()).filter(cell => cell);
        if (headerCells.length > 0) {
          tableHtml += '<thead><tr>';
          headerCells.forEach(cell => {
            // El contenido de las celdas se procesará después con el resto del markdown
            tableHtml += `<th>${cell}</th>`;
          });
          tableHtml += '</tr></thead>';
        }
        
        // Resto son filas de datos
        if (tableRows.length > 1) {
          tableHtml += '<tbody>';
          for (let j = 1; j < tableRows.length; j++) {
            const cells = tableRows[j].split('|').map(cell => cell.trim()).filter(cell => cell);
            if (cells.length > 0) {
              tableHtml += '<tr>';
              cells.forEach(cell => {
                tableHtml += `<td>${cell}</td>`;
              });
              tableHtml += '</tr>';
            }
          }
          tableHtml += '</tbody>';
        }
        
        tableHtml += '</table>';
        tablePlaceholders.push(tableHtml);
        processedLinesForTables.push(`__TABLE_${tableIndex}__`);
        tableRows = [];
        inTable = false;
      }
      
      if (!isTableSeparator) {
        processedLinesForTables.push(line);
      }
    }
  }
  
  // Si terminamos dentro de una tabla, procesarla
  if (inTable && tableRows.length > 0) {
    const tableIndex = tablePlaceholders.length;
    let tableHtml = '<table class="markdown-table">';
    
    const headerCells = tableRows[0].split('|').map(cell => cell.trim()).filter(cell => cell);
    if (headerCells.length > 0) {
      tableHtml += '<thead><tr>';
      headerCells.forEach(cell => {
        tableHtml += `<th>${cell}</th>`;
      });
      tableHtml += '</tr></thead>';
    }
    
    if (tableRows.length > 1) {
      tableHtml += '<tbody>';
      for (let j = 1; j < tableRows.length; j++) {
        const cells = tableRows[j].split('|').map(cell => cell.trim()).filter(cell => cell);
        if (cells.length > 0) {
          tableHtml += '<tr>';
          cells.forEach(cell => {
            tableHtml += `<td>${cell}</td>`;
          });
          tableHtml += '</tr>';
        }
      }
      tableHtml += '</tbody>';
    }
    
    tableHtml += '</table>';
    tablePlaceholders.push(tableHtml);
    processedLinesForTables.push(`__TABLE_${tableIndex}__`);
  }
  
  html = processedLinesForTables.join('\n');
  
  // Procesar listas ANTES de convertir saltos de línea
  // Dividir en líneas para procesar listas correctamente
  const lines = html.split('\n');
  const processedLines = [];
  let inList = false;
  let currentParagraph = [];
  
  function flushParagraph() {
    if (currentParagraph.length > 0) {
      // Unir las líneas del párrafo con <br> y agregar
      const paragraphText = currentParagraph.join('<br>');
      processedLines.push(paragraphText);
      currentParagraph = [];
    }
  }
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Detectar si es un elemento de lista (empieza con -, *, o + seguido de espacio)
    const listMatch = line.match(/^(\s*)([\-\*\+])\s+(.+)$/);
    
    if (listMatch) {
      // Flush cualquier párrafo pendiente
      flushParagraph();
      
      if (!inList) {
        processedLines.push('<ul>');
        inList = true;
      }
      processedLines.push(`<li>${listMatch[3]}</li>`);
    } else {
      if (inList) {
        processedLines.push('</ul>');
        inList = false;
      }
      
      // Si la línea está vacía, flush el párrafo y agregar salto
      if (line.trim() === '') {
        flushParagraph();
        if (processedLines.length > 0 && 
            !processedLines[processedLines.length - 1].endsWith('</ul>') &&
            !processedLines[processedLines.length - 1].endsWith('<hr>') &&
            processedLines[processedLines.length - 1] !== '') {
          processedLines.push('<br>');
        }
      } else {
        // Agregar línea al párrafo actual
        currentParagraph.push(line);
      }
    }
  }
  
  // Flush cualquier párrafo pendiente
  flushParagraph();
  
  // Cerrar lista si aún está abierta
  if (inList) {
    processedLines.push('</ul>');
  }
  
  html = processedLines.join('');
  
  // Restaurar tablas
  html = html.replace(/__TABLE_(\d+)__/g, (match, index) => {
    return tablePlaceholders[parseInt(index)] || '';
  });
  
  // Procesar el contenido de las celdas de las tablas (negritas, enlaces, etc.)
  // Esto se hace después de restaurar las tablas pero antes de restaurar fórmulas matemáticas
  html = html.replace(/(<t[dh]>)(.*?)(<\/t[dh]>)/g, (match, openTag, content, closeTag) => {
    // Procesar negritas, enlaces, etc. dentro de las celdas
    let processedContent = content;
    
    // Los placeholders MATHINLINE y MATHBLOCK ya fueron procesados antes de crear las tablas
    // Solo necesitamos procesar el formato markdown básico aquí
    
    processedContent = processedContent.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    processedContent = processedContent.replace(/__(.+?)__/g, '<strong>$1</strong>');
    processedContent = processedContent.replace(/\*(.+?)\*/g, '<em>$1</em>');
    processedContent = processedContent.replace(/_(.+?)_/g, '<em>$1</em>');
    processedContent = processedContent.replace(/`([^`]+)`/g, '<code>$1</code>');
    processedContent = processedContent.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    return openTag + processedContent + closeTag;
  });
  
  // Restaurar code blocks
  html = html.replace(/__CODE_BLOCK_(\d+)__/g, (match, index) => {
    const code = codeBlocks[parseInt(index)];
    return `<pre><code>${code}</code></pre>`;
  });
  
  // Función auxiliar para procesar fórmulas matemáticas
  function processMathFormula(formula) {
    // Convertir funciones comunes si no tienen backslash
    formula = formula.replace(/\bsqrt\[/g, '\\sqrt[')
                     .replace(/\bsqrt\(/g, '\\sqrt{')
                     .replace(/\bfrac\(/g, '\\frac{')
                     .replace(/\bsum\b/g, '\\sum')
                     .replace(/\bprod\b/g, '\\prod')
                     .replace(/\bint\b/g, '\\int')
                     .replace(/\boint\b/g, '\\oint')
                     .replace(/\biint\b/g, '\\iint')
                     .replace(/\biiint\b/g, '\\iiint')
                     .replace(/\bpartial\b/g, '\\partial')
                     .replace(/\bnabla\b/g, '\\nabla')
                     .replace(/\blim\b/g, '\\lim')
                     .replace(/\bmax\b/g, '\\max')
                     .replace(/\bmin\b/g, '\\min')
                     .replace(/\bsup\b/g, '\\sup')
                     .replace(/\binf\b/g, '\\inf')
                     .replace(/\binfty\b/g, '\\infty')
                     .replace(/\bpi\b/g, '\\pi')
                     .replace(/\btheta\b/g, '\\theta')
                     .replace(/\balpha\b/g, '\\alpha')
                     .replace(/\bbeta\b/g, '\\beta')
                     .replace(/\bgamma\b/g, '\\gamma')
                     .replace(/\bdelta\b/g, '\\delta')
                     .replace(/\bepsilon\b/g, '\\epsilon')
                     .replace(/\blambda\b/g, '\\lambda')
                     .replace(/\bmu\b/g, '\\mu')
                     .replace(/\bsigma\b/g, '\\sigma')
                     .replace(/\bphi\b/g, '\\phi')
                     .replace(/\bomega\b/g, '\\omega')
                     .replace(/\bDelta\b/g, '\\Delta')
                     .replace(/\bGamma\b/g, '\\Gamma')
                     .replace(/\bLambda\b/g, '\\Lambda')
                     .replace(/\bSigma\b/g, '\\Sigma')
                     .replace(/\bPhi\b/g, '\\Phi')
                     .replace(/\bOmega\b/g, '\\Omega')
                     .replace(/\bsin\b/g, '\\sin')
                     .replace(/\bcos\b/g, '\\cos')
                     .replace(/\btan\b/g, '\\tan')
                     .replace(/\bsec\b/g, '\\sec')
                     .replace(/\bcsc\b/g, '\\csc')
                     .replace(/\bcot\b/g, '\\cot')
                     .replace(/\barcsin\b/g, '\\arcsin')
                     .replace(/\barccos\b/g, '\\arccos')
                     .replace(/\barctan\b/g, '\\arctan')
                     .replace(/\bln\b/g, '\\ln')
                     .replace(/\blog\b/g, '\\log')
                     .replace(/\bexp\b/g, '\\exp')
                     .replace(/\bdet\b/g, '\\det')
                     .replace(/\bdim\b/g, '\\dim')
                     .replace(/\bker\b/g, '\\ker')
                     .replace(/\bhom\b/g, '\\hom')
                     .replace(/\bdeg\b/g, '\\deg')
                     .replace(/\bmod\b/g, '\\mod')
                     .replace(/\bgcd\b/g, '\\gcd')
                     .replace(/\blcm\b/g, '\\lcm')
                     .replace(/\bPr\b/g, '\\Pr')
                     .replace(/\barg\b/g, '\\arg')
                     .replace(/\bRe\b/g, '\\Re')
                     .replace(/\bIm\b/g, '\\Im');
    
    // Convertir operadores comunes
    formula = formula.replace(/\*\*/g, '^')  // ** a ^ para exponentes
                     .replace(/\bdiv\b/g, '\\div')
                     .replace(/\btimes\b/g, '\\times')
                     .replace(/\bcdot\b/g, '\\cdot')
                     .replace(/\bpm\b/g, '\\pm')
                     .replace(/\bmp\b/g, '\\mp')
                     .replace(/\bleq\b/g, '\\leq')
                     .replace(/\bgeq\b/g, '\\geq')
                     .replace(/\bneq\b/g, '\\neq')
                     .replace(/\bapprox\b/g, '\\approx')
                     .replace(/\bequiv\b/g, '\\equiv')
                     .replace(/\bcong\b/g, '\\cong')
                     .replace(/\bsim\b/g, '\\sim')
                     .replace(/\bpropto\b/g, '\\propto')
                     .replace(/\bin\b(?=\s)/g, '\\in')
                     .replace(/\bnotin\b/g, '\\notin')
                     .replace(/\bsubset\b/g, '\\subset')
                     .replace(/\bsupset\b/g, '\\supset')
                     .replace(/\bsubseteq\b/g, '\\subseteq')
                     .replace(/\bsupseteq\b/g, '\\supseteq')
                     .replace(/\bcap\b/g, '\\cap')
                     .replace(/\bcup\b/g, '\\cup')
                     .replace(/\bemptyset\b/g, '\\emptyset')
                     .replace(/\bforall\b/g, '\\forall')
                     .replace(/\bexists\b/g, '\\exists')
                     .replace(/\bnexists\b/g, '\\nexists')
                     .replace(/\bland\b/g, '\\land')
                     .replace(/\blor\b/g, '\\lor')
                     .replace(/\blnot\b/g, '\\lnot')
                     .replace(/\brightarrow\b/g, '\\rightarrow')
                     .replace(/\bleftarrow\b/g, '\\leftarrow')
                     .replace(/\bLeftrightarrow\b/g, '\\Leftrightarrow')
                     .replace(/\bRightarrow\b/g, '\\Rightarrow')
                     .replace(/\bLeftarrow\b/g, '\\Leftarrow');
    
    return formula;
  }
  
  // Restaurar fórmulas matemáticas en bloques
  html = html.replace(/__MATH_BLOCK_(\d+)__/g, (match, index) => {
    let formula = mathBlocks[parseInt(index)];
    // Si la fórmula está vacía (placeholder), intentar buscar en el contexto
    if (!formula || formula.trim() === '') {
      return '<span class="math-placeholder">[Fórmula matemática]</span>';
    }
    formula = processMathFormula(formula);
    return `<span class="math-block">$$${formula}$$</span>`;
  });
  
  // Restaurar fórmulas matemáticas inline
  html = html.replace(/__MATH_INLINE_(\d+)__/g, (match, index) => {
    let formula = mathInline[parseInt(index)];
    // Si la fórmula está vacía (placeholder), mostrar un marcador más informativo
    if (!formula || formula.trim() === '') {
      return '<span class="math-placeholder" title="Fórmula matemática pendiente">[Fórmula]</span>';
    }
    formula = processMathFormula(formula);
    return `<span class="math-inline">$${formula}$</span>`;
  });
  
  // Detectar expresiones matemáticas comunes escritas en texto plano dentro de tablas y otros contextos
  // Esto ayuda a convertir texto matemático común a formato LaTeX automáticamente
  
  // Detectar integrales escritas como texto: "∫_a^b f(x) dx" o "integral de a a b"
  html = html.replace(/(?:integral|∫)\s*(?:de|from)?\s*([a-z0-9]+)\s*(?:a|to|hasta)?\s*([a-z0-9]+)\s*(?:de|of)?\s*([^,\s\.;]+)/gi, (match, a, b, func) => {
    return `<span class="math-inline">$\\int_{${a}}^{${b}} ${func}$</span>`;
  });
  
  // Detectar fracciones escritas como texto: "a/b" cuando está en contexto matemático
  // Mejorar la detección de fracciones comunes
  html = html.replace(/(\d+|\w+)\s*\/\s*(\d+|\w+)(?=\s|$|,|;|\)|\.|\))/g, (match, num, den, offset, string) => {
    // Solo convertir si está en contexto matemático claro
    const pos = offset;
    const before = string.substring(Math.max(0, pos - 10), pos);
    const after = string.substring(pos + match.length, pos + match.length + 10);
    
    // Contexto matemático: precedido o seguido de operadores matemáticos, o contiene letras
    const isMathContext = /[=+\-*/(\\∫∑∏]/.test(before) || 
                          /[=+\-*/)\\]/.test(after) || 
                          /[a-zA-Zα-ωΑ-Ω]/.test(num) || 
                          /[a-zA-Zα-ωΑ-Ω]/.test(den) ||
                          match.includes('∫') ||
                          match.includes('∑') ||
                          before.includes('MATH') ||
                          after.includes('MATH');
    
    if (isMathContext && !match.includes('<span')) {
      return `<span class="math-inline">$\\frac{${num}}{${den}}$</span>`;
    }
    return match;
  });
  
  // Detectar expresiones con exponentes y subíndices escritas como texto
  // Ejemplo: "x^2", "x_1", "f(x)", etc.
  html = html.replace(/([a-zA-Zα-ωΑ-Ω])\s*\^\s*(\d+|\w+)/g, (match, base, exp) => {
    const pos = html.indexOf(match);
    const before = html.substring(Math.max(0, pos - 5), pos);
    const after = html.substring(pos + match.length, pos + match.length + 5);
    
    // Solo convertir si está en contexto matemático
    if (/[=+\-*/(\\∫∑∏\s]/.test(before) || /[=+\-*/)\\\s]/.test(after) || before.includes('MATH') || after.includes('MATH')) {
      return `<span class="math-inline">$${base}^{${exp}}$</span>`;
    }
    return match;
  });
  
  html = html.replace(/([a-zA-Zα-ωΑ-Ω])\s*_\s*(\d+|\w+)/g, (match, base, sub) => {
    const pos = html.indexOf(match);
    const before = html.substring(Math.max(0, pos - 5), pos);
    const after = html.substring(pos + match.length, pos + match.length + 5);
    
    // Solo convertir si está en contexto matemático
    if (/[=+\-*/(\\∫∑∏\s]/.test(before) || /[=+\-*/)\\\s]/.test(after) || before.includes('MATH') || after.includes('MATH')) {
      return `<span class="math-inline">$${base}_{${sub}}$</span>`;
    }
    return match;
  });
  
  // Detectar y convertir expresiones matemáticas comunes que no fueron capturadas
  // Buscar patrones como: ∫_a^b f(x) dx, sum_{i=1}^n, etc.
  // Esto debe hacerse después de restaurar las fórmulas protegidas
  
  // Detectar expresiones con subíndices y superíndices comunes
  // Patrón: función_sub^sup (ej: int_a^b, sum_{i=1}^n)
  html = html.replace(/(\\int|\\sum|\\prod|\\lim|\\max|\\min|\\sup|\\inf)\s*_([^{}\s]+?)\^([^{}\s]+?)(?=\s|$|\\|,|;|\)|\.|,)/g, (match, func, sub, sup) => {
    const formula = `${func}_{${sub}}^{${sup}}`;
    return `<span class="math-inline">$${formula}$</span>`;
  });
  
  // Detectar expresiones con llaves: función_{sub}^{sup}
  html = html.replace(/(\\int|\\sum|\\prod|\\lim|\\max|\\min|\\sup|\\inf)\s*_\{([^}]+?)\}\^\{([^}]+?)\}/g, (match, func, sub, sup) => {
    const formula = `${func}_{${sub}}^{${sup}}`;
    return `<span class="math-inline">$${formula}$</span>`;
  });
  
  // Detectar fracciones comunes: a/b cuando está en contexto matemático
  html = html.replace(/(\d+|\w+)\/(\d+|\w+)(?=\s|$|,|;|\)|\.)/g, (match, num, den) => {
    // Solo convertir si está en contexto matemático claro
    const pos = html.indexOf(match);
    const before = html.substring(Math.max(0, pos - 5), pos);
    const after = html.substring(pos + match.length, pos + match.length + 5);
    if (/[=+\-*/(\\]/.test(before) || /[=+\-*/)\\]/.test(after) || /[a-zA-Z]/.test(num) || /[a-zA-Z]/.test(den)) {
      return `<span class="math-inline">$\\frac{${num}}{${den}}$</span>`;
    }
    return match;
  });
  
  return html;
}

async function copyToClipboard(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    
    // Feedback visual - cambiar el icono temporalmente
    const originalHTML = button.innerHTML;
    button.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    button.classList.add('copied');
    
    setTimeout(() => {
      button.innerHTML = originalHTML;
      button.classList.remove('copied');
    }, 1500);
  } catch (err) {
    // Fallback para navegadores que no soportan clipboard API
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    
    try {
      document.execCommand('copy');
      const originalHTML = button.innerHTML;
      button.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
      button.classList.add('copied');
      
      setTimeout(() => {
        button.innerHTML = originalHTML;
        button.classList.remove('copied');
      }, 1500);
    } catch (err) {
      console.error('Error al copiar:', err);
      button.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
      setTimeout(() => {
        button.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
      }, 2000);
    }
    
    document.body.removeChild(textArea);
  }
}

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
  
  // Agregar el contenido del mensaje
  if (message.content) {
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
  
  // Crear elemento para la hora
  const timeElement = document.createElement('span');
  timeElement.className = 'message-time';
  const messageTime = message.timestamp || message.createdAt || Date.now();
  timeElement.textContent = formatTime(messageTime);
  
  copyContainer.appendChild(copyButton);
  copyContainer.appendChild(timeElement);
  
  // Agregar contenido y luego el contenedor de copiar dentro del bubble
  bubble.innerHTML = content;
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
  if (!attachedFiles[id]) {
    attachedFiles[id] = [];
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
  };
  state.conversations[id] = conversation;
  attachedFiles[id] = []; // Inicializar array de archivos para esta conversación
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
  
  // Si hay thinking real (no solo el mensaje genérico), expandirlo por defecto
  const hasRealThinking = thinking && 
    !thinking.includes('Procesó la solicitud en') && 
    thinking.trim().length > 0;
  
  const expandedClass = hasRealThinking ? 'expanded' : '';
  
  return `
    <div class="thinking-block ${expandedClass}" onclick="this.classList.toggle('expanded')">
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
      content += createThinkingBlock('', null, true);
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
      
      const copyButton = document.createElement('button');
      copyButton.className = 'copy-message-btn';
      copyButton.title = 'Copiar mensaje';
      copyButton.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
      
      const timeElement = document.createElement('span');
      timeElement.className = 'message-time';
      
      copyContainer.appendChild(copyButton);
      copyContainer.appendChild(timeElement);
      bubble.appendChild(copyContainer);
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

  const body = {
    model: state.currentModel,
    stream: true,
    messages: payloadMessages,
  };

  // Log para depuración (solo mostrar estructura, no el contenido completo de imágenes)
  console.log('Enviando mensajes al modelo:', {
    model: body.model,
    messageCount: body.messages.length,
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
          duration: assistantMessage.thinkingDuration
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
          if (parsed.thinking || parsed.reasoning || parsed.thought) {
            const thinkingText = parsed.thinking || parsed.reasoning || parsed.thought;
            // Agregar salto de línea si ya hay thinking previo
            if (assistantMessage.thinking && !assistantMessage.thinking.endsWith('\n')) {
              assistantMessage.thinking += '\n';
            }
            assistantMessage.thinking += thinkingText;
            const duration = ((Date.now() - startTime) / 1000).toFixed(0);
            assistantMessage.thinkingDuration = duration;
            
            // Actualizar inmediatamente para thinking (con scroll)
            updateAssistantBubble(bubble, assistantMessage.content, {
              thinking: assistantMessage.thinking,
              duration: duration
            }, false);
            thinkingComplete = true;
            // No persistir en cada chunk de thinking, solo al final
          }

          if (parsed.message?.content) {
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
  
  // Si hay archivos adjuntos, añadir el contexto al primer mensaje del usuario
  // Solo añadir el contexto una vez al inicio de la conversación con archivos
  const hasFiles = attachedFiles[conversation.id] && attachedFiles[conversation.id].length > 0;
  const isFirstMessageWithFiles = hasFiles && conversation.messages.length === 1;
  
  // Separar imágenes de otros archivos
  const imageFiles = hasFiles ? attachedFiles[conversation.id].filter(f => f.isImage) : [];
  const textFiles = hasFiles ? attachedFiles[conversation.id].filter(f => !f.isImage) : [];
  
  // Construir mensaje del sistema combinando información personal, estilo y archivos (solo en el primer mensaje)
  if (isFirstMessage) {
    let systemContent = '';
    
    // Agregar información personal si existe
    if (personalInfo.trim()) {
      systemContent += `Información personal del usuario: ${personalInfo.trim()}\n\n`;
    }
    
    // Agregar contexto de archivos si existen
    if (textFiles.length > 0) {
      systemContent += 'Contexto de archivos adjuntos:\n\n';
      textFiles.forEach(file => {
        systemContent += `--- Archivo: ${file.name} ---\n${file.content}\n\n`;
      });
    }
    
    // Agregar instrucciones del estilo de respuesta
    const responseStyle = getAIResponseStyle();
    const styleInstructions = getStyleInstructions(responseStyle);
    
    // Agregar instrucciones finales
    let instructions = '';
    if (personalInfo.trim() && textFiles.length > 0) {
      instructions = 'Ten en cuenta esta información sobre el usuario y el contenido de estos archivos al responder sus preguntas. Proporciona respuestas más personalizadas cuando sea relevante.';
    } else if (personalInfo.trim()) {
      instructions = 'Ten en cuenta esta información sobre el usuario al responder sus preguntas y proporciona respuestas más personalizadas cuando sea relevante.';
    } else if (textFiles.length > 0) {
      instructions = 'Responde las preguntas del usuario basándote en el contenido de estos archivos cuando sea relevante.';
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
      }
    }
    } else if (textFiles.length > 0) {
    // Para mensajes posteriores, añadir el contexto de archivos al mensaje del usuario actual
    let contextContent = 'Contexto de archivos adjuntos:\n\n';
    textFiles.forEach(file => {
      contextContent += `--- Archivo: ${file.name} ---\n${file.content}\n\n`;
    });
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

function init() {
  if (!chatList) return;

  loadState();
  loadSidebarState();
  
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
        }
      }
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

document.addEventListener('DOMContentLoaded', () => {
  init();
  initBackgroundSystem();
  initUserMenu();
});

