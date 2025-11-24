# Ollama Web Chat 🌟

A modern, elegant web interface for interacting with local Ollama language models.

![Ollama Web Chat](https://img.shields.io/badge/Ollama-Web_Chat-blue?style=for-the-badge)
![Vite](https://img.shields.io/badge/Vite-5.x-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)





## Overview

Ollama Web Chat provides a beautiful, user-friendly interface to chat with your locally running Ollama models. It features real-time streaming responses, conversation management, markdown rendering, and mathematical formula support—all wrapped in a clean, dark-themed UI.


![Ollama Web Chat Preview](./assets/image.png)
## What It Does

### Core Features

- **Chat with Local Models**: Connect to your Ollama instance and interact with any installed model
- **Real-time Streaming**: See responses appear character-by-character as the model generates them
- **Multiple Conversations**: Create, manage, and switch between multiple conversation threads
- **Persistent Storage**: All conversations are automatically saved to browser localStorage
- **Rich Formatting**: Full markdown support including headers, lists, code blocks, and links
- **Mathematical Expressions**: Render LaTeX formulas inline or as display blocks using KaTeX
- **Model Selection**: Easily switch between different Ollama models via a dropdown menu

### User Interface

- **Modern Design**: Clean, minimalist interface with a dark theme and animated starry background
- **Responsive Layout**: Works seamlessly across different screen sizes
- **Conversation Sidebar**: Quick access to all your conversations with rename and delete options
- **Auto-expanding Input**: The message input field grows automatically as you type

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) (v14 or higher)
- [Ollama](https://ollama.ai/) installed and running locally

### Installation

1. **Clone the repository**:
```bash
git clone <repository-url>
cd ollama-web
```

2. **Install dependencies**:
```bash
npm install
```

3. **Start the development server**:
```bash
npm run dev
```

4. **Open your browser**:
Navigate to `http://localhost:5173`

## Usage

1. **Select a model** from the dropdown menu
2. **Type your message** in the input field
3. **Press Enter** or click the send button (↑) to send
4. **Manage conversations** using the sidebar:
   - Click "+ New Conversation" to start a new chat
   - Click the edit icon (✎) to rename a conversation
   - Click the delete icon (🗑) to remove a conversation

## Keyboard Shortcuts

- **Ctrl+B**: Toggle sidebar (show/hide)
- **Ctrl+M**: Create new conversation
- **Ctrl+Shift+;**: Toggle incognito mode (private chat without saving)

## Mathematical Expressions

The app supports LaTeX-style mathematical notation:

- **Inline formulas**: Use `$formula$` for formulas within text
- **Display formulas**: Use `$$formula$$` for centered formulas on their own line

Example:
```
Euler's formula is $e^{i\pi} + 1 = 0$

The Euclidean distance is calculated as:
$$d(x,y) = \sqrt{(x-a)^2 + (y-b)^2}$$
```

## Configuration

### Custom Ollama Port

If Ollama is running on a different port, edit `app.js`:
```javascript
const API_BASE = 'http://localhost:YOUR_PORT';
```

### CORS Settings

If you encounter CORS issues, ensure Ollama allows connections from your origin:
```bash
OLLAMA_ORIGINS=http://localhost:5173 ollama serve
```

## Technology Stack

- **[Vite](https://vitejs.dev/)**: Fast build tool and development server
- **[Ollama API](https://ollama.ai/)**: Local API for language models
- **[KaTeX](https://katex.org/)**: Fast math rendering engine
- **Vanilla JavaScript**: No frameworks, pure and lightweight
- **Modern CSS**: Animations, gradients, and responsive design

## Project Structure

```
ollama-web/
├── index.html          # Main HTML structure
├── styles.css          # Styles and animations
├── app.js             # Application logic
├── package.json       # Dependencies and scripts
├── assets/            # Images and static assets
├── README.md          # This file
└── RAZONAMIENTO.md    # Documentation on reasoning feature
```

## Contributing

Contributions are welcome! If you find a bug or have an idea for improvement:

1. Fork the project
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is open source and available under the [MIT License](LICENSE).

## Acknowledgments

- Powered by [Ollama](https://ollama.ai/)
- Math rendering by [KaTeX](https://katex.org/)

---

Made with ❤️ for the Ollama community


