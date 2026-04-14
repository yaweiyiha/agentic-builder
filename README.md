# Agentic Builder

AI-powered desktop application built with **Next.js** + **Electron**.

## Tech Stack

- **Next.js 15** — App Router, API Routes, React Server Components
- **Electron** — Desktop distribution (macOS / Windows / Linux)
- **TypeScript** — Type safety across the stack
- **Tailwind CSS v4** — Utility-first styling
- **Motion** — Animations
- **OpenRouter** — AI model gateway

## Getting Started

### Prerequisites

- Node.js >= 18
- npm >= 9

### Install

```bash
npm install
```

### Configure

Copy the example env file and add your OpenRouter API key:

```bash
cp .env.example .env.local
```

Edit `.env.local` and set `OPENROUTER_API_KEY`.

### Development

**Web mode** (Next.js only):

```bash
npm run dev
```

**Desktop mode** (Next.js + Electron):

```bash
npm run electron:dev
```

### Build

**Web**:

```bash
npm run build
```

**Desktop**:

```bash
npm run electron:build
```

## Project Structure

```
├── electron/           # Electron main + preload
│   ├── main.js
│   └── preload.js
├── src/
│   ├── app/            # Next.js App Router
│   │   ├── api/        # Server-side API routes
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/     # Shared React components
│   ├── lib/            # Utilities (OpenRouter client, etc.)
│   └── types/          # TypeScript declarations
├── public/             # Static assets
└── package.json
```
