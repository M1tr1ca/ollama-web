const STORAGE_KEY = 'ollama-web-state-v1';

/**
 * @class StateManager
 * @description Manages the application state, including conversations,
 * current model, and persistence in localStorage.
 */
export class StateManager {
  /**
   * Initializes the StateManager by loading the state from localStorage.
   */
  constructor() {
    this.state = {
      conversations: {},
      order: [],
      activeId: null,
      currentModel: null,
      loading: false,
    };
    this.loadState();
  }

  /**
   * Generates a unique ID.
   * @param {string} prefix - The prefix for the ID.
   * @returns {string} The generated ID.
   */
  generateId(prefix) {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  /**
   * Persists the current state to localStorage.
   */
  persistState() {
    const snapshot = {
      conversations: this.state.conversations,
      order: this.state.order,
      activeId: this.state.activeId,
      currentModel: this.state.currentModel,
    };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch (error) {
      console.warn('Could not save state', error);
    }
  }

  /**
   * Loads the state from localStorage.
   */
  loadState() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      this.state.conversations = parsed.conversations ?? {};
      this.state.order = Array.isArray(parsed.order) ? parsed.order : Object.keys(this.state.conversations);
      this.state.activeId = parsed.activeId ?? this.state.order[0] ?? null;
      this.state.currentModel = parsed.currentModel ?? null;
      this.ensureConversationOrder();
    } catch (error) {
      console.warn('Could not restore state', error);
    }
  }

  /**
   * Ensures the conversation order is consistent.
   */
  ensureConversationOrder() {
    this.state.order = this.state.order.filter((id) => Boolean(this.state.conversations[id]));
    Object.keys(this.state.conversations)
      .filter((id) => !this.state.order.includes(id))
      .forEach((id) => this.state.order.push(id));
  }
}
