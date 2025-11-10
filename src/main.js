import { StateManager } from './State.js';
import { UIManager } from './UI.js';
import { ApiClient } from './Api.js';

const DEFAULT_TITLE = 'Nueva conversación';

/**
 * @class App
 * @description Main class that orchestrates the application, initializing and
 * connecting the StateManager, UIManager, and ApiClient.
 */
class App {
  /**
   * Initializes the application by creating instances of the main classes.
   */
  constructor() {
    this.stateManager = new StateManager();
    this.uiManager = new UIManager(this);
    this.apiClient = new ApiClient();

    this.init();
  }

  /**
   * Initializes the application, sets up event listeners, and renders the initial state.
   */
  async init() {
    this.uiManager.chatForm.addEventListener('submit', (e) => this.handleSubmit(e));
    this.uiManager.chatFormInline.addEventListener('submit', (e) => this.handleSubmit(e));
    this.uiManager.newConversationButton.addEventListener('click', () => this.createNewConversation());
    this.uiManager.toggleSidebarButton.addEventListener('click', () => this.uiManager.sidebar.classList.toggle('collapsed'));
    this.uiManager.closeSidebarButton.addEventListener('click', () => this.uiManager.sidebar.classList.add('collapsed'));
    this.uiManager.renameConversationButton.addEventListener('click', () => this.renameConversation());
    this.uiManager.deleteConversationButton.addEventListener('click', () => this.deleteConversation());
    this.uiManager.sidebar.querySelector('.user-card').addEventListener('click', () => {
      console.log('User card clicked. Implement user settings menu here.');
    });

    if (!this.stateManager.state.activeId || !this.stateManager.state.conversations[this.stateManager.state.activeId]) {
      this.createNewConversation();
    } else {
      this.renderCurrentConversation();
    }
  }

  /**
   * Handles the chat form submission.
   * @param {Event} event - The form submission event.
   */
  async handleSubmit(event) {
    event.preventDefault();
    if (this.stateManager.state.loading) return;

    const isEmptyState = this.uiManager.emptyState.style.display !== 'none';
    const activeInput = isEmptyState ? this.uiManager.promptInput : this.uiManager.promptInputInline;
    const originalPrompt = activeInput.value.trim();
    if (!originalPrompt) return;

    this.stateManager.state.loading = true;
    activeInput.value = '';

    const conversation = this.stateManager.state.conversations[this.stateManager.state.activeId];
    const userMessage = { role: 'user', content: originalPrompt, id: this.stateManager.generateId('msg'), withWebSearch: false };
    conversation.messages.push(userMessage);

    if (isEmptyState) {
      this.uiManager.showChatState();
    }
    this.uiManager.appendMessageElement(userMessage);
    this.renderConversationList();

    let promptForOllama = originalPrompt;
    const searchToggle = isEmptyState ? document.getElementById('search-toggle') : document.getElementById('search-toggle-inline');
    if (searchToggle?.checked) {
      if (isEmptyState) {
        this.uiManager.showChatState();
      }
      this.uiManager.showSearchProcess(originalPrompt);
      try {
        const searchResults = await this.apiClient.performWebSearch(originalPrompt);

        if (searchResults && Array.isArray(searchResults.organic)) {
            this.uiManager.renderSources(searchResults.organic);
            const formattedResults = searchResults.organic.map(r => `[${r.title}](${r.link}): ${r.snippet}`).join('\n');
            promptForOllama = `**Web Search Results:**\n${formattedResults}\n\n**User Question:** ${originalPrompt}`;
            userMessage.withWebSearch = true;
        } else {
            console.warn("Web search did not return valid results. Proceeding without them.");
        }

      } catch (error) {
        console.error("Failed to perform web search:", error);
      }
    }

    const payloadMessages = conversation.messages.map(({ role, content }) => ({ role, content }));
    payloadMessages[payloadMessages.length - 1].content = promptForOllama;

    const assistantMessage = { role: 'assistant', content: '', id: this.stateManager.generateId('msg') };
    conversation.messages.push(assistantMessage);
    const { bubble } = this.uiManager.appendMessageElement(assistantMessage);

    try {
      await this.apiClient.streamAssistantResponse(payloadMessages, this.stateManager.state.currentModel, (chunk) => {
        if (chunk.message?.content) {
          assistantMessage.content += chunk.message.content;
          bubble.innerHTML = this.uiManager.parseMarkdown(assistantMessage.content);
          this.uiManager.scrollChatToBottom();
        }
        if (chunk.done) {
          this.stateManager.persistState();
        }
      });
    } catch (error) {
      assistantMessage.content = `⚠️ ${error.message}`;
      bubble.innerHTML = this.uiManager.parseMarkdown(assistantMessage.content);
    } finally {
      this.stateManager.state.loading = false;
      if (searchToggle?.checked) {
        this.uiManager.hideSearchProcess();
      }
    }
  }

  /**
   * Loads the available models and updates the UI.
   */
  async loadModels() {
    try {
      const models = await this.apiClient.loadModels();
      const selects = [this.uiManager.modelSelect, this.uiManager.modelSelectInline];
      selects.forEach(select => {
        select.innerHTML = '';
        models.forEach(model => {
          const option = document.createElement('option');
          option.value = model.name;
          option.textContent = model.name;
          select.appendChild(option);
        });
      });
      const storedModel = this.stateManager.state.currentModel;
      this.stateManager.state.currentModel = models.find(m => m.name === storedModel)?.name || models[0]?.name;
      selects.forEach(select => select.value = this.stateManager.state.currentModel);
    } catch (error) {
      console.error('Failed to load models', error);
    }
  }

  /**
   * Creates a new conversation.
   */
  createNewConversation() {
    const id = this.stateManager.generateId('conv');
    this.stateManager.state.conversations[id] = { id, title: DEFAULT_TITLE, messages: [] };
    this.stateManager.state.order.unshift(id);
    this.setActiveConversation(id);
  }

  /**
   * Sets the active conversation.
   * @param {string} id - The ID of the conversation to set as active.
   */
  setActiveConversation(id) {
    this.stateManager.state.activeId = id;
    this.stateManager.persistState();
    this.renderCurrentConversation();
  }

  /**
   * Renders the currently active conversation.
   */
  renderCurrentConversation() {
    const conversation = this.stateManager.state.conversations[this.stateManager.state.activeId];
    if (!conversation) {
      this.uiManager.showEmptyState();
      return;
    }
    this.uiManager.chatList.innerHTML = '';
    conversation.messages.forEach(message => this.uiManager.appendMessageElement(message));
    this.uiManager.conversationTitle.textContent = conversation.title;
    this.renderConversationList();
  }

  /**
   * Renames the current conversation.
   */
  renameConversation() {
    const conversation = this.stateManager.state.conversations[this.stateManager.state.activeId];
    if (!conversation) return;
    const newTitle = prompt('Enter a new title for the conversation:', conversation.title);
    if (newTitle) {
      conversation.title = newTitle;
      this.stateManager.persistState();
      this.renderCurrentConversation();
    }
  }

  /**
   * Deletes the current conversation.
   */
  deleteConversation() {
    const conversation = this.stateManager.state.conversations[this.stateManager.state.activeId];
    if (!conversation) return;
    if (confirm('Are you sure you want to delete this conversation?')) {
      delete this.stateManager.state.conversations[this.stateManager.state.activeId];
      this.stateManager.state.order = this.stateManager.state.order.filter(id => id !== this.stateManager.state.activeId);
      this.stateManager.state.activeId = this.stateManager.state.order[0] || null;
      this.stateManager.persistState();
      if (this.stateManager.state.activeId) {
        this.renderCurrentConversation();
      } else {
        this.createNewConversation();
      }
    }
  }

  /**
   * Renders the list of conversations.
   */
  renderConversationList() {
    this.uiManager.conversationList.innerHTML = '';
    this.stateManager.state.order.forEach(id => {
      const conversation = this.stateManager.state.conversations[id];
      if (!conversation) return;
      const item = document.createElement('li');
      item.className = `conversation-item${id === this.stateManager.state.activeId ? ' active' : ''}`;
      item.textContent = conversation.title;
      item.addEventListener('click', () => this.setActiveConversation(id));
      this.uiManager.conversationList.appendChild(item);
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new App();
});
