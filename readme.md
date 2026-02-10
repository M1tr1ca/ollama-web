<p align="center">
  <img src="assets/Logo2.png" alt="Kaisio Logo" width="80" />
</p>

<h1 align="center">Kaisio</h1>

<p align="center">
  A privacy-first AI assistant powered by <a href="https://ollama.com">Ollama</a>. Runs entirely on your machine -- your data never leaves your computer.
</p>

<p align="center">
  <a href="#features">Features</a> &middot;
  <a href="#getting-started">Getting Started</a> &middot;
  <a href="#modes">Modes</a> &middot;
  <a href="#api-keys">API Keys</a> &middot;
  <a href="#tech-stack">Tech Stack</a>
</p>

---

![Main Interface](assets/Demo/imageMain.png)

## What is Kaisio?

Kaisio is a full-featured web interface for [Ollama](https://ollama.com) that transforms local LLMs into a versatile personal assistant. Beyond a standard chatbot, it offers specialized modes for health coaching, travel planning, music composition and document editing -- all processed locally for maximum privacy.

Conversations are persisted in the browser via LocalStorage and IndexedDB, so nothing is sent to external servers unless you explicitly configure optional API integrations.

---

## Features

**Chat core** -- Multi-conversation management with project folders, message streaming, incognito mode, PDF/file attachments and Markdown + KaTeX + syntax-highlighted code rendering.

**Deep Research** -- An autonomous research agent that breaks down complex questions, gathers information across multiple iterations and delivers a structured, sourced report.

![Deep Research](assets/Demo/image3DeepResearch.png)
![Deep Research Result](assets/Demo/image3DeepResearchResult.png)

**Projects** -- Organize conversations into folders with context that persists across chats, keeping related work together.

![Projects](assets/Demo/image2Projects.png)

**Canvas** -- A collaborative document editor that lives alongside the chat. Ask the AI to draft, edit or refine text in real time inside a persistent workspace.

**Discover** -- A built-in news feed with weather widget, category filtering and article detail view. Powered by [GNews](https://gnews.io) and [Open-Meteo](https://open-meteo.com).

**To-Do & Calendar** -- Lightweight task management and calendar panels accessible from the sidebar for quick planning without leaving the app.

**Memory & Personalization** -- The AI remembers facts about you across sessions. Configure your name, personal context and preferred response style (concise, explanatory, formal, learning-oriented, etc.).

**Themes & Accessibility** -- 7 built-in color themes plus a custom color picker. OpenDyslexic font toggle for improved readability. Background personalization with daily images.

**i18n** -- Full interface translation for ES, EN, FR, DE and RO.

**Virtual Pet** -- An animated pixel cat that walks, climbs, sleeps and meows across your screen. Toggle it on or off from settings.

---

## Modes

Kaisio includes specialized chat modes that unlock dedicated tools and UI:

### Health & Wellness

A personal coach for nutrition, exercise and mental wellbeing. It generates structured recipe cards with ingredients and macros, gym/running routines with real exercise GIFs from [ExerciseDB](https://exercisedb.io), weekly meal plans and guided breathing sessions. Includes a health profile (age, weight, height, goals) for personalized recommendations.

> Disclaimer: Kaisio is not a medical device. It does not diagnose or prescribe. Always consult a healthcare professional.

![Health Mode](assets/Demo/imageSalud.png)
![Health Recipes](assets/Demo/imageSalud2.png)

### Travel

Plan trips directly in the chat. The AI generates interactive maps using [Leaflet](https://leafletjs.com) + [OpenStreetMap](https://www.openstreetmap.org) with real walking/driving routes via [OSRM](https://project-osrm.org). Points of interest, distances and durations are rendered inline.

![Travel Mode](assets/Demo/imageMaps.png)

### Music

Compose and edit musical scores collaboratively using [ABC notation](https://abcnotation.com). Kaisio renders sheet music in real time with [abcjs](https://www.abcjs.net) inside a dedicated score canvas. Ask the AI to create, transpose or modify passages through natural language.

![Music Mode](assets/Demo/imageMusic.png)

---

## Getting Started

### Prerequisites

| Requirement | Version |
|---|---|
| [Node.js](https://nodejs.org) | >= 18 |
| [Ollama](https://ollama.com) | Latest |

Pull at least one model before starting:

```bash
ollama pull llama3
```

### Install & Run

```bash
git clone https://github.com/M1tr1ca/ollama-web.git
cd ollama-web
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Production (PM2)

```bash
npm start        # Start with PM2
npm run logs     # View logs
npm run stop     # Stop the process
```

---

## API Keys

All API keys are optional. Kaisio works fully offline with just Ollama. Configure them from **Settings > API Keys** inside the app.

| Service | Purpose | Link |
|---|---|---|
| [GNews](https://gnews.io) | News feed in the Discover panel | [Get key](https://gnews.io/register) |
| [Mapbox](https://www.mapbox.com) | Enhanced maps in Travel mode | [Get key](https://account.mapbox.com) |

Weather data uses [Open-Meteo](https://open-meteo.com) (free, no key required). Geolocation and routing use [OpenStreetMap](https://www.openstreetmap.org) / [OSRM](https://project-osrm.org) (free, no key required).

---

## Tech Stack

- **Frontend** -- Vanilla JS, CSS custom properties, no framework
- **Build** -- [Vite](https://vitejs.dev)
- **AI Backend** -- [Ollama](https://ollama.com) REST API (localhost:11434)
- **Rendering** -- [Marked](https://marked.js.org) (Markdown), [KaTeX](https://katex.org) (math), [Highlight.js](https://highlightjs.org) (code), [abcjs](https://www.abcjs.net) (music), [pdf.js](https://mozilla.github.io/pdf.js/) (PDF), [jsPDF](https://github.com/parallax/jsPDF) (export)
- **Maps** -- [Leaflet](https://leafletjs.com) + [OpenStreetMap](https://www.openstreetmap.org) + [OSRM](https://project-osrm.org)
- **Process Manager** -- [PM2](https://pm2.keymetrics.io)

---

<p align="center">
  Built with local-first principles. Your data stays yours.
</p>
