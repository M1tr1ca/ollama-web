/**
 * @class UIManager
 * @description Manages all DOM interactions, such as rendering messages,
 * updating the conversation list, and handling UI events.
 */
export class UIManager {
  /**
   * Initializes the UIManager by caching the DOM elements.
   */
  constructor() {
    this.cacheDOMElements();
  }

  /**
   * Caches the DOM elements for later use.
   */
  cacheDOMElements() {
    this.chatList = document.getElementById('chat-list');
    this.chatForm = document.getElementById('chat-form');
    this.chatFormInline = document.getElementById('chat-form-inline');
    this.promptInput = document.getElementById('prompt-input');
    this.promptInputInline = document.getElementById('prompt-input-inline');
    this.modelSelect = document.getElementById('model-select');
    this.modelSelectInline = document.getElementById('model-select-inline');
    this.conversationList = document.getElementById('conversation-list');
    this.newConversationButton = document.getElementById('new-conversation');
    this.renameConversationButton = document.getElementById('rename-conversation');
    this.deleteConversationButton = document.getElementById('delete-conversation');
    this.conversationTitle = document.getElementById('conversation-title');
    this.emptyState = document.getElementById('empty-state');
    this.chatState = document.getElementById('chat-state');
    this.searchProcessContainer = document.getElementById('search-process-container');
    this.searchQueryText = document.getElementById('search-query-text');
    this.sourcesCount = document.getElementById('sources-count');
    this.sourcesList = document.getElementById('sources-list');
    this.sidebar = document.querySelector('.sidebar');
    this.toggleSidebarButton = document.getElementById('toggle-sidebar');
    this.closeSidebarButton = document.getElementById('close-sidebar');
  }

  /**
   * Renders the conversation list in the sidebar.
   * @param {Array<object>} conversations - The list of conversations.
   * @param {string} activeConversationId - The ID of the active conversation.
   */
  renderConversationList(conversations, activeConversationId) {
    this.conversationList.innerHTML = '';
    conversations.forEach(conv => {
      const li = document.createElement('li');
      li.className = `conversation-item ${conv.id === activeConversationId ? 'active' : ''}`;
      li.dataset.id = conv.id;
      li.textContent = conv.title;
      this.conversationList.appendChild(li);
    });
  }

  /**
   * Appends a message element to the chat list.
   * @param {object} message - The message object to render.
   * @returns {object} The created list item and bubble elements.
   */
  appendMessageElement(message) {
    const li = document.createElement('li');
    li.className = `message ${message.role}`;

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = message.role === 'user' ? 'Tú' : 'AI';

    if (message.withWebSearch) {
      const webSearchBadge = document.createElement('div');
      webSearchBadge.className = 'web-search-badge';
      webSearchBadge.textContent = 'Web Search';
      li.appendChild(webSearchBadge);
    }

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.innerHTML = this.parseMarkdown(message.content);

    li.append(avatar, bubble);
    this.chatList?.appendChild(li);
    this.scrollChatToBottom();
    return { li, bubble };
  }

  /**
   * Scrolls the chat to the bottom.
   */
  scrollChatToBottom() {
    requestAnimationFrame(() => {
      this.chatList?.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    });
  }

  /**
   * Parses markdown text to HTML.
   * @param {string} text - The markdown text.
   * @returns {string} The parsed HTML.
   */
  parseMarkdown(text) {
    if (!text) return '';
    let html = text;
    html = html.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    html = html.replace(/\n/g, '<br>');
    return html;
  }

  /**
   * Shows the empty state of the chat.
   */
  showEmptyState() {
    if (this.emptyState) this.emptyState.style.display = 'flex';
    if (this.chatState) this.chatState.style.display = 'none';
  }

  /**
   * Shows the chat state.
   */
  showChatState() {
    if (this.emptyState) this.emptyState.style.display = 'none';
    if (this.chatState) this.chatState.style.display = 'flex';
  }

  /**
   * Shows the search process container and displays the user's query.
   * @param {string} query - The user's search query.
   */
  showSearchProcess(query) {
    if (this.searchProcessContainer) {
      this.searchProcessContainer.style.display = 'block';
    }
    if (this.searchQueryText) {
      this.searchQueryText.textContent = query;
    }
    // Clear previous sources
    if (this.sourcesList) {
      this.sourcesList.innerHTML = '';
    }
    if (this.sourcesCount) {
      this.sourcesCount.textContent = '0';
    }
  }

  /**
   * Hides the search process container.
   */
  hideSearchProcess() {
    if (this.searchProcessContainer) {
      this.searchProcessContainer.style.display = 'none';
    }
  }

  /**
   * Renders the list of sources and updates the count.
   * @param {Array<object>} sources - The list of sources to render.
   */
  renderSources(sources) {
    console.log('Rendering sources:', sources); // Debugging line
    if (!this.sourcesList || !this.sourcesCount) return;

    this.sourcesList.innerHTML = '';
    this.sourcesCount.textContent = sources.length;

    sources.forEach(source => {
      const link = document.createElement('a');
      link.className = 'source-item source-link';
      link.href = source.link;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';

      const favicon = document.createElement('img');
      favicon.className = 'source-favicon';
      favicon.src = `https://www.google.com/s2/favicons?domain=${new URL(source.link).hostname}&sz=32`;
      favicon.alt = '';

      const sourceInfo = document.createElement('div');
      sourceInfo.className = 'source-info';

      const title = document.createElement('span');
      title.className = 'source-title';
      title.textContent = source.title;

      const hostname = document.createElement('span');
      hostname.className = 'source-hostname';
      hostname.textContent = new URL(source.link).hostname.replace(/^www\./, '');

      sourceInfo.append(title, hostname);
      link.append(favicon, sourceInfo);
      this.sourcesList.appendChild(link);
    });
  }
}
