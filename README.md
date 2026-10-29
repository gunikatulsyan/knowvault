# KnowVault — Agentic Personal Knowledge Management System

KnowVault is an AI-powered personal knowledge management application that allows users to create and manage notes, retrieve relevant information, and ask questions about their knowledge base through a conversational AI assistant.

The project demonstrates how **MongoDB and Redis can work together in a full-stack application**, combining persistent document storage with caching, conversation history, and analytics.

## Features

- **Knowledge Management:** Create, read, update, and delete notes.
- **AI-Powered Question Answering:** Ask natural-language questions about stored knowledge.
- **Context-Aware Conversations:** Use previous questions and conversation history to improve follow-up responses.
- **MongoDB Storage:** Store notes as flexible documents in MongoDB Atlas.
- **Redis Caching:** Cache eligible AI responses to reduce repeated language-model calls.
- **Conversation History:** Store recent questions and answers temporarily in Redis.
- **Analytics Dashboard:** Track cache hits, cache misses, AI generations, saved LLM calls, active sessions, and cache hit rate.
- **Local AI Inference:** Generate responses using Llama 3.2 3B through Ollama.

## Technology Stack

| Component | Technology |
|---|---|
| Frontend | React, Vite |
| Backend | Python, FastAPI |
| Primary database | MongoDB Atlas |
| Cache and temporary storage | Redis |
| Language model runtime | Ollama |
| Language model | Llama 3.2 3B |
| API communication | REST APIs |
| Version control | Git, GitHub |

## Architecture

1. The React frontend provides the interface for managing notes and interacting with the AI assistant.
2. The FastAPI backend handles API requests, note operations, knowledge retrieval, and AI orchestration.
3. MongoDB Atlas stores notes persistently as documents.
4. Redis stores cached responses, temporary conversation history, and analytics counters.
5. Ollama runs the local Llama 3.2 3B model to generate AI responses using the question and relevant context.

## Project Structure

```text
knowvault/
├── backend/
│   ├── main.py
│   ├── .env
│   └── venv/
├── frontend/
│   ├── src/
│   ├── package.json
│   └── ...
├── .gitignore
└── README.md
```

*Note: The `.env` file and virtual environment are local-only and must not be committed to GitHub.*

## Prerequisites

- Python 3
- Node.js and npm
- MongoDB Atlas account and connection string
- Redis server
- Ollama
- Llama 3.2 3B model downloaded in Ollama

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/gunikatulsyan/knowvault.git
cd knowvault
```

### 2. Configure MongoDB and Redis

Create a MongoDB Atlas cluster and database. Configure the connection string and database name in your backend environment.

Start your local Redis server:

```bash
brew services start redis
redis-cli ping
```

The expected response is `PONG`.

### 3. Configure and start the backend

Navigate to the backend directory:

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
```

Install the backend dependencies:

```bash
pip install -r requirements.txt
```

Create a local `.env` file using the environment variable names expected by `main.py`. Configure your MongoDB connection string, database name, Ollama model, and Redis URL. Do not commit real credentials.

Start the FastAPI server:

```bash
uvicorn main:app --reload --port 8000
```

The API documentation is available at:

http://127.0.0.1:8000/docs

### 4. Configure and start the frontend

Open a second terminal:

```bash
cd ~/knowvault/frontend
npm install
npm run dev
```

Open the local URL displayed by Vite, normally:

http://localhost:5173

Ensure the frontend API URL points to the running backend.

### 5. Start Ollama

Install Ollama and download the model if you haven't already:

```bash
ollama pull llama3.2:3b
```

Ollama should be running and accessible to the backend at its configured local endpoint, normally `http://localhost:11434`.

If Ollama is already running as a background service, you do not need to start another instance.

## Database Design

### MongoDB Atlas

The `notes` collection stores knowledge items as documents with fields such as:

- `title`
- `content`
- `category`
- `tags`

MongoDB provides persistent storage for the application's knowledge base.

### Redis

Redis supports multiple workloads using different data structures:

- **String:** Cached AI responses and analytics counters.
- **List:** Conversation history.
- **Sorted set:** Active-session tracking.

Temporary entries use expiration settings where configured.

## API Overview

| Endpoint | Method | Purpose |
|---|---|---|
| `/` | GET | Backend health information |
| `/notes` | GET | Retrieve notes |
| `/notes` | POST | Create a note |
| `/notes/{note_id}` | PUT | Update a note |
| `/notes/{note_id}` | DELETE | Delete a note |
| `/ask` | POST | Ask the AI assistant a question |
| `/analytics` | GET | Retrieve Redis analytics |
| `/chat-history/{session_id}` | GET | Retrieve conversation history |
| `/chat-history/{session_id}` | DELETE | Clear conversation history |
| `/redis-test` | GET | Check Redis connectivity |
| `/ai-test` | GET | Check AI integration |

Refer to the interactive FastAPI documentation for the request formats and responses.

## Security

- Never commit `.env` files, passwords, database connection strings, or other secrets.
- Restrict MongoDB Atlas network access to trusted IP addresses or appropriately configured deployment networks.
- Use secure credentials and access controls for production databases.
- Do not expose a locally running Ollama service directly to the public internet.

## Project Status

The core application includes note management, AI-assisted knowledge retrieval, context-aware conversations, Redis caching, conversation history, and analytics.

The current setup is designed for local development, using MongoDB Atlas as the hosted database and Redis and Ollama as local services.

## Future Improvements

- Semantic search and vector-based retrieval.
- More advanced agent planning and tool use.
- Automated tests and performance evaluation.
- Authentication and user-specific knowledge spaces.
- Cloud deployment of the backend, Redis, and AI inference.
- Improved monitoring and error handling.

## Author

**Gunika Tulsyan**

GitHub: https://github.com/gunikatulsyan
