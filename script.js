/* Chat client with conversation history, user name, latest-question, and typing indicator */

// DOM
const chatForm = document.getElementById("chatForm");
const userInput = document.getElementById("userInput");
const chatWindow = document.getElementById("chatWindow");
const latestQuestionEl = document.getElementById("latestQuestion");

// Replace with your deployed Cloudflare Worker URL
const WORKER_URL = "https://loreal.anvimsiddabhattuni.workers.dev";

// Configuration
const HISTORY_KEY = "loreal_chat_history_v1";
const NAME_KEY = "loreal_user_name_v1";
const MAX_HISTORY_MESSAGES = 20; // keep last N messages (user+assistant entries)
const baseSystemPrompt = `You are the L'Oréal Smart Product Advisor. Only answer user questions about L'Oréal products (makeup, skincare, haircare, fragrances), product details, and personalized routines or recommendations. If a user asks about anything outside L'Oréal products or routines, reply briefly that you can only assist with L'Oréal product-related questions and offer to help within that scope.`;

// Helpers: persistence & escaping
function saveHistory(history) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch (e) {
    console.warn("Unable to save chat history:", e);
  }
}
function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch (e) {
    return [];
  }
}
function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Append a chat bubble (plain text)
function appendMessage(text, cls) {
  const el = document.createElement("div");
  el.className = `msg ${cls}`;
  el.textContent = text;
  chatWindow.appendChild(el);
  chatWindow.scrollTop = chatWindow.scrollHeight;
  return el;
}

// Append a typing indicator bubble (returns the element so caller can remove it)
function appendTypingIndicator() {
  const el = document.createElement("div");
  el.className = "msg ai typing";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = `<span class="typing-dots" aria-hidden="true"><span></span><span></span><span></span></span>`;
  chatWindow.appendChild(el);
  chatWindow.scrollTop = chatWindow.scrollHeight;
  return el;
}

// Show latest question above responses
function setLatestQuestion(text) {
  if (!text) {
    latestQuestionEl.innerHTML = "";
    latestQuestionEl.style.display = "none";
    latestQuestionEl.setAttribute("aria-hidden", "true");
  } else {
    latestQuestionEl.innerHTML = `<strong>Your question</strong>: ${escapeHtml(
      text
    )}`;
    latestQuestionEl.style.display = "block";
    latestQuestionEl.setAttribute("aria-hidden", "false");
  }
}

// Ensure user name exists (persisted)
function getUserName() {
  let name = localStorage.getItem(NAME_KEY);
  if (!name) {
    // simple prompt for demo use — replace with a nicer UI if desired
    name = window.prompt("What's your name?", "") || "Friend";
    localStorage.setItem(NAME_KEY, name);
  }
  return name;
}

// Build system prompt including user's name so assistant can personalize
function systemPromptFor(name) {
  return `${baseSystemPrompt}\nUser name: ${name}. Use the user's name when appropriate.`;
}

// Initialize UI from history
const userName = getUserName();
let history = loadHistory(); // history is array of {role: 'user'|'assistant', content: '...'}
if (!Array.isArray(history)) history = [];

// Render saved conversation
if (history.length === 0) {
  // Add a friendly local assistant intro and persist it
  const welcome = `Hi ${userName}! I'm your L'Oréal Smart Product Advisor. Ask me about products, routines, or personalised recommendations.`;
  appendMessage(welcome, "ai");
  history.push({ role: "assistant", content: welcome });
  saveHistory(history);
} else {
  // render saved messages
  for (const m of history) {
    appendMessage(m.content, m.role === "user" ? "user" : "ai");
  }
}

// Handle submit (maintain history, display latest question, call worker)
chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const userText = userInput.value.trim();
  if (!userText) return;

  // Update UI: latest question + user bubble
  setLatestQuestion(userText);
  appendMessage(userText, "user");

  // Add to in-memory history and persist
  history.push({ role: "user", content: userText });
  if (history.length > MAX_HISTORY_MESSAGES) {
    history = history.slice(-MAX_HISTORY_MESSAGES);
  }
  saveHistory(history);

  userInput.value = "";
  userInput.blur();

  // Show typing indicator (AI)
  const typingEl = appendTypingIndicator();

  // Build messages for the API: system prompt (with name) + conversation history
  const messagesToSend = [
    { role: "system", content: systemPromptFor(userName) },
    // send the saved history (user/assistant pairs)
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];

  try {
    const resp = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: messagesToSend,
        max_tokens: 600,
        temperature: 0.2,
      }),
    });

    // remove typing indicator
    typingEl.remove();

    if (!resp.ok) {
      const text = await resp.text();
      appendMessage("Server error. See console.", "ai");
      console.error("Worker returned non-OK:", resp.status, text);
      return;
    }

    const data = await resp.json();
    const reply = data?.choices?.[0]?.message?.content?.trim();

    if (reply) {
      appendMessage(reply, "ai");
      // Save assistant reply into history and persist
      history.push({ role: "assistant", content: reply });
      if (history.length > MAX_HISTORY_MESSAGES) {
        history = history.slice(-MAX_HISTORY_MESSAGES);
      }
      saveHistory(history);
    } else {
      appendMessage("No reply received. Check worker logs.", "ai");
      console.error("Unexpected worker response:", data);
    }
  } catch (err) {
    // remove typing indicator if it's still present
    try {
      typingEl.remove();
    } catch (e) {}
    appendMessage("Network error. Check console.", "ai");
    console.error(err);
  }
});
