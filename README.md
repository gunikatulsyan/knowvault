# KnowVault — Agentic Personal Knowledge Management System

KnowVault is an AI-powered personal knowledge management application that helps users store notes, retrieve relevant information, and ask questions about their knowledge base through a conversational AI assistant.

## Features

- **Knowledge Management:** Create, view, update, and delete notes.
- **AI Assistant:** Ask questions about saved knowledge using a locally running language model.
- **Context-Aware Conversations:** Use previous conversation context to improve follow-up answers.
- **NoSQL Storage:** Store flexible note documents in MongoDB Atlas.
- **Redis Caching:** Cache responses and track cache performance.
- **Chat History:** Store conversation history temporarily in Redis.
- **Analytics Dashboard:** Monitor cache hits, cache misses, AI generations, and saved LLM calls.

## Technology Stack

| Component | Technology |
|---|---|
| Frontend | React, Vite |
| Backend | Python, FastAPI |
| Primary database | MongoDB Atlas |
| Cache and temporary data | Redis |
| Local language model | Ollama — Llama 3.2 3B |

## Architecture

The React frontend communicates with the FastAPI backend. MongoDB Atlas stores notes, Redis supports caching and temporary conversation data, and Ollama generates AI responses locally.

## Project Structure

```text
knowvault/
├── backend/
├── frontend/
├── .gitignore
└── README.md
```

## Prerequisites

- Python 3
- Node.js and npm
- MongoDB Atlas account and connection string
- Redis
- Ollama with the required model downloaded

## Setup

### 1. Clone the repository

```bash
git clone YOUR_GITHUB_REPOSITORY_URL
cd knowvault
```

### 2. Configure the backend

Create and activate a Python virtual environment, install the backend dependencies, and configure the required environment variables in a local `.env` file.

### 3. Configure the frontend

Install the frontend dependencies:

```bash
cd frontend
npm install
```

Configure the backend URL as required by the project.

### 4. Start the services

Start Redis, ensure MongoDB Atlas is accessible, and start Ollama with the configured model.

Run the FastAPI backend and React frontend using the commands appropriate to their configurations.

## Security

Do not commit environment files, database credentials, passwords, API keys, or other secrets to version control.

## Project Status

Core functionality, including note management, AI-assisted retrieval, Redis analytics, and conversation context, has been implemented.

## Future Improvements

- Improve semantic knowledge retrieval.
- Expand evaluation of AI answer quality.
- Add more comprehensive error handling and automated tests.
- Improve documentation and deployment options.
