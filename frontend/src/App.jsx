
import { useCallback, useEffect, useState } from "react";
import "./App.css";

const API_URL =
  import.meta.env.VITE_API_URL || "https://knowvault-udqh.onrender.com";

const EMPTY_ANALYTICS = {
  cache_hits: 0,
  cache_misses: 0,
  ai_generations: 0,
  llm_calls_saved: 0,
  active_sessions: 0,
  cache_hit_rate: 0,
  total_cache_requests: 0,
};

function App() {
  // -----------------------------
  // SESSION
  // -----------------------------

  const [sessionId] = useState(() => crypto.randomUUID());

  // -----------------------------
  // NOTES STATE
  // -----------------------------

  const [notes, setNotes] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [notesError, setNotesError] = useState("");

  const [form, setForm] = useState({
    title: "",
    content: "",
    category: "",
    tags: "",
  });

  // -----------------------------
  // AI STATE
  // -----------------------------

  const [question, setQuestion] = useState("");
  const [aiAnswer, setAiAnswer] = useState("");
  const [aiSource, setAiSource] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [agentSteps, setAgentSteps] = useState([]);
  const [aiError, setAiError] = useState("");

  // -----------------------------
  // CONVERSATION HISTORY
  // -----------------------------

  const [chatHistory, setChatHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");

  // -----------------------------
  // REDIS ANALYTICS
  // -----------------------------

  const [analytics, setAnalytics] = useState(EMPTY_ANALYTICS);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState("");

  // -----------------------------
  // FETCH NOTES
  // -----------------------------

  const fetchNotes = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/notes`);

      if (!response.ok) {
        throw new Error("Could not load notes.");
      }

      const data = await response.json();
      setNotes(Array.isArray(data) ? data : []);
      setNotesError("");
    } catch (error) {
      console.error("Error fetching notes:", error);
      setNotesError(
        "Could not connect to the backend. Make sure FastAPI is running."
      );
    }
  }, []);

  // -----------------------------
  // FETCH ANALYTICS
  // -----------------------------

  const fetchAnalytics = useCallback(async (showLoading = false) => {
    if (showLoading) {
      setAnalyticsLoading(true);
    }

    try {
      const response = await fetch(`${API_URL}/analytics`);

      if (!response.ok) {
        throw new Error("Could not load Redis analytics.");
      }

      const data = await response.json();

      setAnalytics({
        ...EMPTY_ANALYTICS,
        ...data,
      });

      setAnalyticsError("");
    } catch (error) {
      console.error("Analytics error:", error);
      setAnalyticsError(
        "Unable to load analytics. Check that the backend and Redis are running."
      );
    } finally {
      if (showLoading) {
        setAnalyticsLoading(false);
      }
    }
  }, []);

  // -----------------------------
  // FETCH CONVERSATION HISTORY
  // -----------------------------

  const fetchChatHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError("");

    try {
      const response = await fetch(
        `${API_URL}/chat-history/${sessionId}`
      );

      if (!response.ok) {
        throw new Error("Could not load conversation history.");
      }

      const data = await response.json();

      setChatHistory(
        Array.isArray(data.messages) ? data.messages : []
      );
    } catch (error) {
      console.error("History error:", error);
      setHistoryError(error.message || "Unable to load history.");
    } finally {
      setHistoryLoading(false);
    }
  }, [sessionId]);

  // -----------------------------
  // INITIAL LOAD + AUTO REFRESH
  // -----------------------------

  useEffect(() => {
    fetchNotes();
    fetchAnalytics();
    fetchChatHistory();

    const interval = setInterval(() => {
      fetchAnalytics();
    }, 5000);

    return () => clearInterval(interval);
  }, [fetchNotes, fetchAnalytics, fetchChatHistory]);

  // -----------------------------
  // ASK AI
  // -----------------------------

  const askAI = async () => {
    if (!question.trim() || aiLoading) return;

    setAiLoading(true);
    setAiAnswer("");
    setAiSource("");
    setAgentSteps([]);
    setAiError("");

    try {
      const response = await fetch(`${API_URL}/ask`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: question.trim(),
          session_id: sessionId,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "The AI request failed.");
      }

      setAiAnswer(data.answer || "No answer was returned.");
      setAiSource(data.source || "unknown");
      setAgentSteps(
        Array.isArray(data.agent_steps) ? data.agent_steps : []
      );

      // Refresh Redis-backed information after each question.
      await Promise.all([
        fetchChatHistory(),
        fetchAnalytics(),
      ]);
    } catch (error) {
      console.error("AI assistant error:", error);
      setAiError(
        error.message || "Unable to connect to the AI assistant."
      );
    } finally {
      setAiLoading(false);
    }
  };

  // -----------------------------
  // FORM INPUT
  // -----------------------------

  const handleChange = (event) => {
    const { name, value } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));
  };

  // -----------------------------
  // RESET FORM
  // -----------------------------

  const resetForm = () => {
    setForm({
      title: "",
      content: "",
      category: "",
      tags: "",
    });

    setEditingId(null);
    setShowForm(false);
  };

  // -----------------------------
  // CREATE / UPDATE NOTE
  // -----------------------------

  const handleSubmit = async (event) => {
    event.preventDefault();

    const note = {
      title: form.title.trim(),
      content: form.content.trim(),
      category: form.category.trim() || "General",
      tags: form.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    };

    try {
      const url = editingId
        ? `${API_URL}/notes/${editingId}`
        : `${API_URL}/notes`;

      const response = await fetch(url, {
        method: editingId ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(note),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || "Could not save the note.");
      }

      resetForm();
      await fetchNotes();

      setAiAnswer("");
      setAiSource("");
      setAgentSteps([]);
      setAiError("");

      await fetchAnalytics();
    } catch (error) {
      console.error("Error saving note:", error);
      window.alert(error.message || "Could not save note.");
    }
  };

  // -----------------------------
  // EDIT NOTE
  // -----------------------------

  const editNote = (note) => {
    setForm({
      title: note.title || "",
      content: note.content || "",
      category: note.category || "",
      tags: Array.isArray(note.tags) ? note.tags.join(", ") : "",
    });

    setEditingId(note._id);
    setShowForm(true);

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  // -----------------------------
  // DELETE NOTE
  // -----------------------------

  const deleteNote = async (id) => {
    const confirmed = window.confirm(
      "Are you sure you want to delete this knowledge item?"
    );

    if (!confirmed) return;

    try {
      const response = await fetch(`${API_URL}/notes/${id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || "Could not delete the note.");
      }

      await fetchNotes();

      setAiAnswer("");
      setAiSource("");
      setAgentSteps([]);
      setAiError("");

      await fetchAnalytics();
    } catch (error) {
      console.error("Error deleting note:", error);
      window.alert(error.message || "Could not delete note.");
    }
  };

  // -----------------------------
  // CLEAR CONVERSATION HISTORY
  // -----------------------------

  const clearHistory = async () => {
    const confirmed = window.confirm(
      "Clear this session's conversation history?"
    );

    if (!confirmed) return;

    try {
      const response = await fetch(
        `${API_URL}/chat-history/${sessionId}`,
        { method: "DELETE" }
      );

      if (!response.ok) {
        throw new Error("Could not clear conversation history.");
      }

      setChatHistory([]);
      setHistoryError("");
    } catch (error) {
      console.error("Clear history error:", error);
      setHistoryError(error.message);
    }
  };

  // -----------------------------
  // RENDER UI
  // -----------------------------

  return (
    <div className="app">
      {/* NAVBAR */}

      <nav className="navbar">
        <div>
          <h1>KnowVault</h1>
          <p>Agentic Personal Knowledge Management</p>
        </div>

        <button
          type="button"
          className="add-button"
          onClick={() => {
            if (showForm) {
              resetForm();
            } else {
              setShowForm(true);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }
          }}
        >
          {showForm ? "Close" : "+ Add Knowledge"}
        </button>
      </nav>

      <main className="container">
        {/* HERO */}

        <section className="hero">
          <div>
            <h2>Your Knowledge</h2>
            <p>Store your knowledge today. Ask your AI about it later.</p>
          </div>

          <div className="stats">
            <div className="stat-card">
              <strong>{notes.length}</strong>
              <span>Knowledge Items</span>
            </div>

            <div className="stat-card">
              <strong>AI</strong>
              <span>Assistant</span>
            </div>
          </div>
        </section>

        {/* REDIS ANALYTICS DASHBOARD */}

        <section className="analytics-section">
          <div className="analytics-header">
            <div>
              <h2>Redis Analytics</h2>
              <p>Live performance of your KnowVault AI assistant.</p>
            </div>

            <button
              type="button"
              className="analytics-refresh"
              onClick={() => fetchAnalytics(true)}
              disabled={analyticsLoading}
            >
              {analyticsLoading ? "Refreshing..." : "↻ Refresh"}
            </button>
          </div>

          {analyticsError && (
            <div className="analytics-error" role="alert">
              <p>{analyticsError}</p>
              <button type="button" onClick={() => fetchAnalytics(true)}>
                Retry
              </button>
            </div>
          )}

          <div className="analytics-grid">
            <div className="analytics-card">
              <span className="analytics-icon">⚡</span>
              <p>Cache Hits</p>
              <strong>{analytics.cache_hits}</strong>
              <small>Answers served from Redis cache</small>
            </div>

            <div className="analytics-card">
              <span className="analytics-icon">🔍</span>
              <p>Cache Misses</p>
              <strong>{analytics.cache_misses}</strong>
              <small>Requests not found in cache</small>
            </div>

            <div className="analytics-card">
              <span className="analytics-icon">🤖</span>
              <p>AI Generations</p>
              <strong>{analytics.ai_generations}</strong>
              <small>Answers generated by Ollama</small>
            </div>

            <div className="analytics-card">
              <span className="analytics-icon">💡</span>
              <p>LLM Calls Saved</p>
              <strong>{analytics.llm_calls_saved}</strong>
              <small>Cache hits that avoided generation</small>
            </div>

            <div className="analytics-card">
              <span className="analytics-icon">👥</span>
              <p>Active Sessions</p>
              <strong>{analytics.active_sessions}</strong>
              <small>Sessions active in the last 24 hours</small>
            </div>

            <div className="analytics-card">
              <span className="analytics-icon">📊</span>
              <p>Cache Hit Rate</p>
              <strong>
                {Number(analytics.cache_hit_rate || 0).toFixed(2)}%
              </strong>
              <small>
                {analytics.total_cache_requests} total cache checks
              </small>
            </div>
          </div>

          <p className="analytics-footnote">
            Metrics refresh every 5 seconds. Active sessions represent
            sessions seen in the last 24 hours, subject to backend tracking.
          </p>
        </section>

        {/* ADD / EDIT KNOWLEDGE FORM */}

        {showForm && (
          <section className="form-card">
            <h2>{editingId ? "Edit Knowledge" : "Add Knowledge"}</h2>

            <form onSubmit={handleSubmit}>
              <label htmlFor="note-title">Title</label>
              <input
                id="note-title"
                type="text"
                name="title"
                placeholder="e.g. Introduction to Machine Learning"
                value={form.title}
                onChange={handleChange}
                required
              />

              <label htmlFor="note-category">Category</label>
              <input
                id="note-category"
                type="text"
                name="category"
                placeholder="e.g. Artificial Intelligence"
                value={form.category}
                onChange={handleChange}
                required
              />

              <label htmlFor="note-tags">Tags</label>
              <input
                id="note-tags"
                type="text"
                name="tags"
                placeholder="e.g. ML, AI, Python"
                value={form.tags}
                onChange={handleChange}
              />

              <label htmlFor="note-content">Content</label>
              <textarea
                id="note-content"
                name="content"
                placeholder="Write or paste your knowledge here..."
                value={form.content}
                onChange={handleChange}
                rows={8}
                required
              />

              <div className="form-actions">
                <button
                  type="button"
                  className="cancel-button"
                  onClick={resetForm}
                >
                  Cancel
                </button>

                <button type="submit" className="save-button">
                  {editingId ? "Update Knowledge" : "Save Knowledge"}
                </button>
              </div>
            </form>
          </section>
        )}

        {/* AI KNOWLEDGE ASSISTANT */}

        <section className="ai-section">
          <div className="ai-header">
            <div>
              <h2>🤖 AI Knowledge Assistant</h2>
              <p>Ask questions about the knowledge stored in KnowVault.</p>
            </div>
          </div>

          <form
            className="ai-input-row"
            onSubmit={(event) => {
              event.preventDefault();
              askAI();
            }}
          >
            <input
              type="text"
              aria-label="Ask your knowledge base"
              placeholder="What do I know about Machine Learning?"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
            />

            <button type="submit" disabled={aiLoading || !question.trim()}>
              {aiLoading ? "Thinking..." : "Ask AI"}
            </button>
          </form>

          {aiLoading && (
            <p className="ai-loading">
              Searching your knowledge and generating an answer...
            </p>
          )}

          {aiError && (
            <div className="ai-error" role="alert">
              {aiError}
            </div>
          )}

          {aiAnswer && (
            <div className="ai-answer">
              <h3>AI Answer</h3>

              <p className="ai-answer-text">{aiAnswer}</p>

              <span className="ai-source">Source: {aiSource}</span>

              {agentSteps.length > 0 && (
                <div className="agent-steps">
                  <h4>🤖 Agent Activity</h4>

                  {agentSteps.map((step, index) => (
                    <div className="agent-step" key={index}>
                      <span aria-hidden="true">✓</span>
                      <span>{step}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {/* CONVERSATION HISTORY */}

        <section className="history-section">
          <div className="history-header">
            <div>
              <h2>💬 Conversation History</h2>
              <p>Your recent questions and answers stored in Redis.</p>
            </div>

            <div className="history-actions">
              <button
                type="button"
                className="analytics-refresh"
                onClick={fetchChatHistory}
                disabled={historyLoading}
              >
                {historyLoading ? "Loading..." : "↻ Refresh"}
              </button>

              <button
                type="button"
                className="history-clear-button"
                onClick={clearHistory}
                disabled={chatHistory.length === 0}
              >
                Clear
              </button>
            </div>
          </div>

          {historyError && (
            <div className="history-error" role="alert">
              {historyError}
            </div>
          )}

          {!historyError &&
            chatHistory.length === 0 &&
            !historyLoading && (
              <div className="history-empty">
                <span>🗨️</span>
                <h3>No conversation history yet</h3>
                <p>Ask the AI a question to start your conversation.</p>
              </div>
            )}

          {historyLoading && chatHistory.length === 0 && (
            <p>Loading conversation history...</p>
          )}

          <div className="history-list">
            {chatHistory.map((message, index) => (
              <article
                className={`history-message ${
                  message.role === "user"
                    ? "history-user"
                    : "history-assistant"
                }`}
                key={`${index}-${message.role}`}
              >
                <div className="history-message-label">
                  {message.role === "user" ? "👤 You" : "🤖 KnowVault AI"}
                </div>

                <p>{message.content}</p>
              </article>
            ))}
          </div>
        </section>

        {/* KNOWLEDGE NOTES */}

        <section className="notes-section">
          {notesError && (
            <div className="notes-error" role="alert">
              {notesError}
              <button type="button" onClick={fetchNotes}>
                Retry
              </button>
            </div>
          )}

          {notes.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📚</div>
              <h3>No knowledge yet</h3>
              <p>Add your first knowledge item to get started.</p>

              <button
                type="button"
                className="add-button"
                onClick={() => setShowForm(true)}
              >
                + Add Your First Note
              </button>
            </div>
          ) : (
            <div className="notes-grid">
              {notes.map((note) => (
                <article className="note-card" key={note._id}>
                  <div className="note-header">
                    <div>
                      <span className="category">
                        {note.category || "General"}
                      </span>
                      <h3>{note.title}</h3>
                    </div>

                    <div className="note-actions">
                      <button
                        type="button"
                        className="edit-button"
                        onClick={() => editNote(note)}
                      >
                        Edit
                      </button>

                      <button
                        type="button"
                        className="delete-button"
                        onClick={() => deleteNote(note._id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  <p className="note-content">{note.content}</p>

                  <div className="tags">
                    {note.tags?.map((tag, index) => (
                      <span key={`${tag}-${index}`}>#{tag}</span>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
