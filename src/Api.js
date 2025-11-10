/**
 * @class ApiClient
 * @description Manages all communications with external APIs,
 * including the Ollama backend and the web search proxy.
 */
export class ApiClient {
  /**
   * Initializes the ApiClient with the base URLs for the Ollama and proxy services.
   */
  constructor() {
    this.ollamaBase = 'http://localhost:11434';
    this.proxyBase = 'http://localhost:3000/api';
  }

  /**
   * Loads the available models from the Ollama API.
   * @returns {Promise<Array>} A promise that resolves to an array of models.
   */
  async loadModels() {
    const response = await fetch(`${this.ollamaBase}/api/tags`);
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    return data?.models ?? [];
  }

  /**
   * Performs a web search using the local proxy.
   * @param {string} query - The search query.
   * @returns {Promise<string>} A promise that resolves to the search results in markdown format.
   */
  async performWebSearch(query) {
    console.log('Performing web search for:', query); // Debugging line
    const response = await fetch(`${this.proxyBase}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query }),
    });
    if (!response.ok) {
      throw new Error(`Error fetching search results: ${response.statusText}`);
    }
    const data = await response.json();
    return data;
  }

  /**
   * Streams the assistant's response from the Ollama API.
   * @param {Array} messages - The array of messages in the conversation.
   * @param {string} model - The model to use for the response.
   * @param {Function} onChunk - The callback function to handle each chunk of the response.
   */
  async streamAssistantResponse(messages, model, onChunk) {
    const body = { model, stream: true, messages };
    const response = await fetch(`${this.ollamaBase}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok || !response.body) {
      throw new Error(`Error querying the model: ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

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
          onChunk(parsed);
        } catch (parseError) {
          console.warn('Could not parse a stream chunk', parseError, line);
        }
      }
    }
  }
}
