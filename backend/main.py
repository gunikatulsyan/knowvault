import os
import json
import hashlib
import asyncio
import uuid
import time
from contextlib import asynccontextmanager

import ollama
import redis.asyncio as redis
from bson import ObjectId
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field


# =========================================================
# CONFIGURATION
# =========================================================

load_dotenv()

MONGO_URL = os.getenv("MONGO_URL")
DATABASE_NAME = os.getenv("DATABASE_NAME", "knowvault")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:3b")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

if not MONGO_URL:
    raise RuntimeError("MONGO_URL is missing from backend/.env")

CHAT_TTL = 86400
MAX_HISTORY_MESSAGES = 10
ACTIVE_SESSION_TTL = 86400
ANSWER_CACHE_TTL = 3600


# =========================================================
# DATABASE CONNECTIONS
# =========================================================

mongo_client = AsyncIOMotorClient(MONGO_URL)
db = mongo_client[DATABASE_NAME]
notes_collection = db["notes"]

redis_client = redis.from_url(
    REDIS_URL,
    decode_responses=True,
)


# =========================================================
# APPLICATION LIFESPAN
# =========================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    mongo_client.close()
    await redis_client.aclose()


app = FastAPI(
    title="KnowVault API",
    description=(
        "Personal Knowledge Management using MongoDB, "
        "Redis, and local Ollama AI."
    ),
    lifespan=lifespan,
)


# =========================================================
# CORS
# =========================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =========================================================
# PYDANTIC MODELS
# =========================================================

class Note(BaseModel):
    title: str
    content: str
    category: str = "General"
    tags: list[str] = Field(default_factory=list)


class Question(BaseModel):
    question: str
    session_id: str | None = None


# =========================================================
# GENERAL HELPERS
# =========================================================

def format_note(note: dict) -> dict:
    note["_id"] = str(note["_id"])
    return note


async def invalidate_qa_cache():
    """Delete cached answers when knowledge notes change."""
    keys = [
        key
        async for key in redis_client.scan_iter(match="qa:*")
    ]
    if keys:
        await redis_client.delete(*keys)


# =========================================================
# REDIS CONVERSATION HISTORY
# =========================================================

def get_chat_key(session_id: str) -> str:
    return f"chat:{session_id}"


async def get_chat_history(session_id: str) -> list[dict]:
    """Return recent valid messages from Redis."""
    raw_messages = await redis_client.lrange(
        get_chat_key(session_id),
        -MAX_HISTORY_MESSAGES,
        -1,
    )

    history = []
    for raw_message in raw_messages:
        try:
            message = json.loads(raw_message)
            if (
                isinstance(message, dict)
                and message.get("role") in {"user", "assistant"}
                and isinstance(message.get("content"), str)
            ):
                history.append(message)
        except (json.JSONDecodeError, TypeError):
            continue

    return history


async def save_chat_turn(
    session_id: str,
    question: str,
    answer: str,
):
    """Store one user/assistant turn and retain recent messages."""
    key = get_chat_key(session_id)

    await redis_client.rpush(
        key,
        json.dumps({"role": "user", "content": question}),
        json.dumps({"role": "assistant", "content": answer}),
    )
    await redis_client.ltrim(key, -MAX_HISTORY_MESSAGES, -1)
    await redis_client.expire(key, CHAT_TTL)


# =========================================================
# REDIS ANALYTICS
# =========================================================

async def record_analytics(
    event: str,
    session_id: str | None = None,
):
    """Track cache usage, generations, and recently active sessions."""
    now = time.time()

    async with redis_client.pipeline(transaction=True) as pipe:
        if event == "cache_hit":
            pipe.incr("stats:cache_hits")
            pipe.incr("stats:llm_calls_saved")
        elif event == "cache_miss":
            pipe.incr("stats:cache_misses")
        elif event == "ai_generation":
            pipe.incr("stats:ai_generations")

        if session_id:
            pipe.zadd("stats:active_sessions", {session_id: now})
            pipe.zremrangebyscore(
                "stats:active_sessions",
                "-inf",
                now - ACTIVE_SESSION_TTL,
            )
            pipe.expire("stats:active_sessions", ACTIVE_SESSION_TTL)

        await pipe.execute()


async def get_analytics() -> dict:
    """Return analytics counters from Redis."""
    values = await redis_client.mget(
        "stats:cache_hits",
        "stats:cache_misses",
        "stats:ai_generations",
        "stats:llm_calls_saved",
    )

    (
        cache_hits,
        cache_misses,
        ai_generations,
        llm_calls_saved,
    ) = [int(value or 0) for value in values]

    now = time.time()
    await redis_client.zremrangebyscore(
        "stats:active_sessions",
        "-inf",
        now - ACTIVE_SESSION_TTL,
    )
    active_sessions = await redis_client.zcard("stats:active_sessions")

    total_requests = cache_hits + cache_misses
    cache_hit_rate = (
        round(cache_hits / total_requests * 100, 2)
        if total_requests
        else 0
    )

    return {
        "cache_hits": cache_hits,
        "cache_misses": cache_misses,
        "ai_generations": ai_generations,
        "llm_calls_saved": llm_calls_saved,
        "active_sessions": active_sessions,
        "cache_hit_rate": cache_hit_rate,
        "total_cache_requests": total_requests,
    }


# =========================================================
# KNOWLEDGE RETRIEVAL
# =========================================================

def search_knowledge(query: str, notes: list[dict]) -> list[dict]:
    """Rank notes using lightweight keyword relevance."""
    stop_words = {
        "the", "is", "are", "a", "an", "and", "or",
        "to", "of", "in", "on", "for", "with",
        "what", "how", "why", "can", "you", "me",
        "it", "its", "this", "that", "about",
        "explain", "tell", "give", "please", "show",
        "list", "describe", "some", "my", "do", "does",
        "from", "their", "them", "they", "i", "we",
    }

    query_lower = " ".join(query.lower().split())
    words = {
        word.strip(".,?!:;()[]{}\"'")
        for word in query_lower.split()
    }
    words = {word for word in words if word and word not in stop_words}

    ranked = []
    for note in notes:
        title = str(note.get("title", "")).lower()
        content = str(note.get("content", "")).lower()
        category = str(note.get("category", "")).lower()
        tags_value = note.get("tags", [])
        if not isinstance(tags_value, list):
            tags_value = []
        tags = " ".join(str(tag) for tag in tags_value).lower()
        searchable_text = f"{title} {content} {category} {tags}"

        score = 0
        for word in words:
            if word in title:
                score += 6
            if word in category:
                score += 4
            if word in tags:
                score += 5
            if word in content:
                score += 2

        if query_lower and query_lower in searchable_text:
            score += 10

        if score > 0:
            ranked.append((score, note))

    ranked.sort(key=lambda item: item[0], reverse=True)
    return [note for _, note in ranked[:5]]


def build_note_context(matching_notes: list[dict]) -> str:
    """Convert matching notes into a compact prompt context."""
    context_parts = []

    for note in matching_notes:
        tags = note.get("tags", [])
        if not isinstance(tags, list):
            tags = []

        context_parts.append(
            f"Title: {note.get('title', '')}\n"
            f"Category: {note.get('category', 'General')}\n"
            f"Tags: {', '.join(str(tag) for tag in tags)}\n"
            f"Content: {note.get('content', '')}"
        )

    return "\n\n---\n\n".join(context_parts)


def resolve_followup_query(question: str, history: list[dict]) -> tuple[str, bool]:
    """
    Expand short follow-ups with the previous user question.
    Returns (retrieval_query, is_followup).
    """
    previous_user_questions = [
        message["content"]
        for message in history
        if message.get("role") == "user"
        and isinstance(message.get("content"), str)
    ]

    if not previous_user_questions:
        return question, False

    is_short = len(question.split()) <= 5
    if not is_short:
        return question, False

    previous_question = previous_user_questions[-1]
    retrieval_query = f"{previous_question} {question}"
    return retrieval_query, True


# =========================================================
# LOCAL AI GENERATION
# =========================================================

async def generate_answer(
    question: str,
    context: str,
    history: list[dict],
) -> str:
    """Generate an answer with Ollama, notes, and recent history."""
    messages = [
        {
            "role": "system",
            "content": (
                "You are KnowVault, a helpful personal knowledge assistant. "
                "Use recent conversation history to understand follow-up "
                "questions. For example, if the previous topic was Machine "
                "Learning and the user asks 'types', explain the types of "
                "Machine Learning. If the user asks 'examples' or 'explain "
                "the second one', resolve that reference from the conversation. "
                "Use supplied MongoDB notes as the source for claims about "
                "the user's saved knowledge. If the notes lack details, say "
                "so clearly. You may also provide general educational "
                "information when useful, but distinguish it from the user's "
                "saved notes. Be accurate, clear, and concise."
            ),
        },
        {
            "role": "system",
            "content": (
                "Relevant notes retrieved from MongoDB:\n"
                f"{context if context else 'No relevant notes found.'}"
            ),
        },
    ]

    # Only accept valid chat roles from the stored conversation.
    for message in history:
        role = message.get("role")
        content = message.get("content")
        if role in {"user", "assistant"} and isinstance(content, str):
            messages.append({"role": role, "content": content})

    messages.append({"role": "user", "content": question})

    response = await asyncio.to_thread(
        ollama.chat,
        model=OLLAMA_MODEL,
        messages=messages,
    )

    return response["message"]["content"]


# =========================================================
# HEALTH CHECK
# =========================================================

@app.get("/")
async def root():
    return {
        "message": "KnowVault API is running",
        "databases": ["MongoDB", "Redis"],
        "ai_model": OLLAMA_MODEL,
    }


# =========================================================
# MONGODB CRUD: CREATE NOTE
# =========================================================

@app.post("/notes")
async def create_note(note: Note):
    result = await notes_collection.insert_one(note.model_dump())
    await invalidate_qa_cache()

    created_note = await notes_collection.find_one(
        {"_id": result.inserted_id}
    )
    return format_note(created_note)


# =========================================================
# MONGODB CRUD: READ NOTES
# =========================================================

@app.get("/notes")
async def get_notes():
    notes = await (
        notes_collection.find()
        .sort("_id", -1)
        .to_list(1000)
    )
    return [format_note(note) for note in notes]


# =========================================================
# MONGODB CRUD: UPDATE NOTE
# =========================================================

@app.put("/notes/{note_id}")
async def update_note(note_id: str, note: Note):
    if not ObjectId.is_valid(note_id):
        raise HTTPException(status_code=400, detail="Invalid note ID")

    result = await notes_collection.update_one(
        {"_id": ObjectId(note_id)},
        {"$set": note.model_dump()},
    )

    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Note not found")

    await invalidate_qa_cache()

    updated_note = await notes_collection.find_one(
        {"_id": ObjectId(note_id)}
    )
    return format_note(updated_note)


# =========================================================
# MONGODB CRUD: DELETE NOTE
# =========================================================

@app.delete("/notes/{note_id}")
async def delete_note(note_id: str):
    if not ObjectId.is_valid(note_id):
        raise HTTPException(status_code=400, detail="Invalid note ID")

    result = await notes_collection.delete_one(
        {"_id": ObjectId(note_id)}
    )

    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Note not found")

    await invalidate_qa_cache()
    return {"message": "Note deleted successfully"}


# =========================================================
# REDIS CONNECTION TEST
# =========================================================

@app.get("/redis-test")
async def redis_test():
    await redis_client.set(
        "knowvault:test",
        "Redis is working",
        ex=60,
    )
    value = await redis_client.get("knowvault:test")
    return {"redis": "connected", "test_value": value}


# =========================================================
# REDIS CONVERSATION HISTORY
# =========================================================

@app.get("/chat-history/{session_id}")
async def read_chat_history(session_id: str):
    history = await get_chat_history(session_id)
    return {
        "session_id": session_id,
        "messages": history,
        "expires_in_seconds": CHAT_TTL,
    }


@app.delete("/chat-history/{session_id}")
async def clear_chat_history(session_id: str):
    await redis_client.delete(get_chat_key(session_id))
    return {
        "message": "Conversation history cleared",
        "session_id": session_id,
    }


# =========================================================
# REDIS ANALYTICS ENDPOINT
# =========================================================

@app.get("/analytics")
async def analytics():
    return await get_analytics()


# =========================================================
# AI: ASK KNOWVAULT
# =========================================================

@app.post("/ask")
async def ask_question(payload: Question):
    question = payload.question.strip()

    if not question:
        raise HTTPException(
            status_code=400,
            detail="Question cannot be empty",
        )

    session_id = payload.session_id or str(uuid.uuid4())
    if len(session_id) > 100:
        raise HTTPException(
            status_code=400,
            detail="Session ID is too long",
        )

    # 1. Read recent conversation from Redis.
    history = await get_chat_history(session_id)

    # 2. Resolve short follow-ups using the previous question.
    retrieval_query, is_followup = resolve_followup_query(
        question,
        history,
    )

    # 3. Retrieve knowledge from MongoDB.
    all_notes = await notes_collection.find().to_list(1000)
    matching_notes = search_knowledge(retrieval_query, all_notes)

    # If combined search is too restrictive, try the previous topic.
    if not matching_notes and is_followup:
        previous_user_questions = [
            message["content"]
            for message in history
            if message.get("role") == "user"
            and isinstance(message.get("content"), str)
        ]
        if previous_user_questions:
            matching_notes = search_knowledge(
                previous_user_questions[-1],
                all_notes,
            )

    context = build_note_context(matching_notes)

    # 4. Include session, question, retrieved context, and recent history
    # in the cache key so a follow-up cannot reuse an unrelated answer.
    normalized_question = " ".join(question.lower().split())
    history_fingerprint_source = json.dumps(
        history[-4:],
        sort_keys=True,
        ensure_ascii=False,
    )
    cache_material = (
        f"{session_id}|{normalized_question}|{context}|"
        f"{history_fingerprint_source}"
    )
    digest = hashlib.sha256(cache_material.encode("utf-8")).hexdigest()
    cache_key = f"qa:{digest}"

    # 5. Check Redis answer cache.
    cached_answer = await redis_client.get(cache_key)

    if cached_answer:
        await record_analytics("cache_hit", session_id)
        await save_chat_turn(session_id, question, cached_answer)

        return {
            "answer": cached_answer,
            "source": "redis_cache",
            "session_id": session_id,
            "agent_steps": [
                "Read recent conversation history from Redis",
                f"Retrieved {len(matching_notes)} relevant note(s) from MongoDB",
                "Found a matching answer in the Redis cache",
                "Saved this turn to Redis conversation history",
            ],
        }

    await record_analytics("cache_miss", session_id)

    # 6. Generate an answer with Ollama. Even when no note matches,
    # history can provide context and the assistant can answer generally.
    try:
        answer = await generate_answer(
            question,
            context,
            history,
        )
    except Exception as error:
        print(f"Ollama generation error: {error}")
        raise HTTPException(
            status_code=503,
            detail=(
                "The local AI could not generate an answer. "
                "Check that Ollama is running and the configured model "
                "is available."
            ),
        )

    await record_analytics("ai_generation", session_id)

    # 7. Cache the response for one hour.
    await redis_client.set(cache_key, answer, ex=ANSWER_CACHE_TTL)

    # 8. Save this turn to Redis history.
    await save_chat_turn(session_id, question, answer)

    return {
        "answer": answer,
        "source": (
            "ollama + mongodb"
            if matching_notes
            else "ollama + conversation history"
        ),
        "session_id": session_id,
        "agent_steps": [
            "Read recent conversation history from Redis",
            (
                f"Retrieved {len(matching_notes)} relevant "
                "note(s) from MongoDB"
            ),
            (
                "Used previous conversation context to interpret "
                "the follow-up question"
                if is_followup
                else "Processed the current question"
            ),
            "Generated an answer using local Ollama AI",
            "Cached the answer in Redis for one hour",
            "Saved this turn to Redis conversation history",
        ],
    }


# =========================================================
# LOCAL AI TEST
# =========================================================

@app.get("/ai-test")
async def ai_test():
    try:
        response = await asyncio.to_thread(
            ollama.chat,
            model=OLLAMA_MODEL,
            messages=[
                {
                    "role": "user",
                    "content": "Reply with: KnowVault local AI is working.",
                }
            ],
        )
    except Exception as error:
        print(f"Ollama test error: {error}")
        raise HTTPException(
            status_code=503,
            detail="Ollama is unavailable or the model is not installed.",
        )

    return {"answer": response["message"]["content"]}
d 