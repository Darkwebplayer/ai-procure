const form = document.getElementById("job-form");
const requestInput = document.getElementById("requestText");
const locationInput = document.getElementById("locationText");
const micBtn = document.getElementById("mic-btn");
const jobMetaEl = document.getElementById("job-meta");
const topQuotesEl = document.getElementById("top-quotes");
const vendorsEl = document.getElementById("vendors");
const questionnaireCard = document.getElementById("questionnaire-card");
const questionnaireFields = document.getElementById("questionnaire-fields");
const questionnaireSubtitle = document.getElementById("questionnaire-subtitle");
const questionnaireSubmitBtn = document.getElementById("questionnaire-submit");
const questionnaireSkipBtn = document.getElementById("questionnaire-skip");

let activeJobId = null;
let pollTimer = null;
let questionnaireContext = null;

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.continuous = false;
  recognition.interimResults = false;

  recognition.addEventListener("result", (event) => {
    const transcript = event.results[0][0].transcript;
    requestInput.value = transcript;
  });

  recognition.addEventListener("start", () => micBtn.classList.add("active"));
  recognition.addEventListener("end", () => micBtn.classList.remove("active"));
}

micBtn.addEventListener("click", () => {
  if (!recognition) {
    alert("Speech recognition is not supported in this browser.");
    return;
  }
  recognition.start();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const requestText = requestInput.value.trim();
  const locationText = locationInput.value.trim();

  if (!requestText || !locationText) return;

  if (
    questionnaireContext &&
    questionnaireContext.requestText === requestText &&
    questionnaireContext.locationText === locationText
  ) {
    await submitJobWithQuestionnaire(false);
    return;
  }

  await generateQuestionnaire(requestText, locationText);
});

questionnaireSubmitBtn.addEventListener("click", async () => {
  await submitJobWithQuestionnaire(false);
});

questionnaireSkipBtn.addEventListener("click", async () => {
  await submitJobWithQuestionnaire(true);
});

async function generateQuestionnaire(requestText, locationText) {
  setBusy(true);

  try {
    const response = await fetch("/api/questionnaire", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestText, locationText })
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    const data = await response.json();
    const questions = Array.isArray(data.questions) ? data.questions : [];

    questionnaireContext = {
      requestText,
      locationText,
      questions
    };

    renderQuestionnaire(questions, requestText, locationText);
    renderMessage(
      data.source === "ai"
        ? "AI questionnaire ready. Choose the best options, then start outreach."
        : "Fallback questionnaire ready. Choose options, then start outreach."
    );
  } catch (error) {
    renderMessage(`Failed to generate questionnaire: ${String(error)}`);
  } finally {
    setBusy(false);
  }
}

async function submitJobWithQuestionnaire(skip) {
  if (!questionnaireContext) {
    return;
  }

  const { requestText, locationText, questions } = questionnaireContext;
  const answers = skip ? [] : collectQuestionnaireAnswers(questions);

  if (!skip) {
    const missingRequired = answers.some((row) => row.required && !row.answer);
    if (missingRequired) {
      renderMessage("Please answer required questions or click Skip.");
      return;
    }
  }

  setBusy(true);
  questionnaireSubmitBtn.disabled = true;
  questionnaireSkipBtn.disabled = true;

  try {
    const payloadAnswers = answers
      .filter((row) => row.answer)
      .map((row) => ({
        questionId: row.id,
        prompt: row.prompt,
        answer: row.answer
      }));

    const response = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestText,
        locationText,
        maxQuotes: 4,
        questionnaireAnswers: payloadAnswers
      })
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    const data = await response.json();
    activeJobId = data.jobId;
    questionnaireContext = null;
    questionnaireCard.classList.add("hidden");
    renderMessage("Job queued. Discovering vendors...");
    startPolling();
  } catch (error) {
    renderMessage(`Failed to create job: ${String(error)}`);
  } finally {
    setBusy(false);
    questionnaireSubmitBtn.disabled = false;
    questionnaireSkipBtn.disabled = false;
  }
}

function collectQuestionnaireAnswers(questions) {
  return questions.map((q) => {
    const selectEl = questionnaireFields.querySelector(`[data-question-id='${q.id}']`);
    const noteEl = questionnaireFields.querySelector(`[data-question-note='${q.id}']`);
    const selected = selectEl ? selectEl.value.trim() : "";
    const note = noteEl ? noteEl.value.trim() : "";
    let answer = "";

    if (selected === "__other__") {
      answer = note;
    } else if (selected && note) {
      answer = `${selected}; Details: ${note}`;
    } else {
      answer = selected;
    }

    return {
      id: q.id,
      prompt: q.prompt,
      required: Boolean(q.required),
      answer
    };
  });
}

function bindQuestionnaireInteractions(questions) {
  for (const q of questions) {
    const selectEl = questionnaireFields.querySelector(`[data-question-id='${q.id}']`);
    const noteWrapEl = questionnaireFields.querySelector(`[data-question-note-wrap='${q.id}']`);
    if (!selectEl || !noteWrapEl) continue;

    const toggle = () => {
      if (selectEl.value === "__other__") {
        noteWrapEl.classList.remove("hidden");
      } else {
        noteWrapEl.classList.add("hidden");
      }
    };

    selectEl.addEventListener("change", toggle);
    toggle();
  }
}

function renderQuestionnaire(questions, requestText, locationText) {
  questionnaireCard.classList.remove("hidden");
  questionnaireSubtitle.textContent = `Help us get accurate quotes for "${requestText}" in ${locationText}.`;

  questionnaireFields.innerHTML = questions
    .map(
      (q) => `
        <div class="questionnaire-row">
          <p><strong>${escapeHtml(q.prompt)}</strong>${q.required ? " *" : ""}</p>
          <select class="questionnaire-select" data-question-id="${escapeHtml(q.id)}">
            <option value="">Select an option</option>
            ${(Array.isArray(q.options) ? q.options : [])
              .map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`)
              .join("")}
            ${q.allowCustomAnswer ? `<option value="__other__">Other (type below)</option>` : ""}
          </select>
          ${
            q.allowCustomAnswer
              ? `<div class="questionnaire-note-wrap hidden" data-question-note-wrap="${escapeHtml(q.id)}">
                  <textarea data-question-note="${escapeHtml(q.id)}" placeholder="${escapeHtml(q.placeholder || "Add details (optional)")}"></textarea>
                 </div>`
              : ""
          }
        </div>
      `
    )
    .join("");

  bindQuestionnaireInteractions(questions);
}

function setBusy(isBusy) {
  const submitBtn = form.querySelector("button[type='submit']");
  submitBtn.disabled = isBusy;
  submitBtn.textContent = isBusy ? "Loading..." : "Find Quotes";
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollJob();
  pollTimer = setInterval(pollJob, 2500);
}

async function pollJob() {
  if (!activeJobId) return;

  const [jobRes, vendorsRes] = await Promise.all([
    fetch(`/api/jobs/${activeJobId}`),
    fetch(`/api/jobs/${activeJobId}/vendors`)
  ]);

  if (!jobRes.ok || !vendorsRes.ok) return;

  const jobData = await jobRes.json();
  const vendorData = await vendorsRes.json();

  renderJob(jobData);
  renderTopQuotes(jobData.topQuotes || []);
  renderVendors(vendorData.vendors || []);

  if (["completed", "failed"].includes(jobData.job.status)) {
    clearInterval(pollTimer);
  }
}

function renderJob(data) {
  const items = [
    ["Status", data.job.status],
    ["Request", data.job.request_text],
    ["Location", data.job.location_text],
    ["Vendors", `${data.progress.vendorsResponded}/${data.progress.vendorsFound}`],
    ["Quotes", `${data.progress.quotesCollected}/${data.progress.targetQuotes}`]
  ];

  jobMetaEl.innerHTML = items
    .map(
      ([label, value]) =>
        `<div class="meta-row"><strong>${escapeHtml(label)}:</strong> <span>${escapeHtml(String(value))}</span></div>`
    )
    .join("");
}

function renderTopQuotes(rows) {
  if (!rows.length) {
    topQuotesEl.className = "quote-list empty";
    topQuotesEl.textContent = "No complete quotes yet.";
    return;
  }

  topQuotesEl.className = "quote-list";
  topQuotesEl.innerHTML = rows
    .map((q) => {
      const hasRange = q.priceMin !== null || q.priceMax !== null;
      const min = q.priceMin ?? "?";
      const max = q.priceMax ?? "?";
      const range = hasRange ? `${q.currency || "USD"} ${min} - ${max}` : "Price pending";
      const timeline = q.timelineDays === null ? "-" : `${q.timelineDays} days`;
      return `
        <div class="quote-row">
          <div><strong>#${q.rank} ${escapeHtml(q.vendorName)}</strong></div>
          <div>${escapeHtml(range)}</div>
          <div>${escapeHtml(timeline)}</div>
          <div>Score ${Number(q.totalScore).toFixed(2)}</div>
          <div><span class="tag ok">${Math.round(q.confidence * 100)}% confidence</span></div>
        </div>
      `;
    })
    .join("");
}

function renderVendors(rows) {
  if (!rows.length) {
    vendorsEl.className = "vendor-list empty";
    vendorsEl.textContent = "No vendors yet.";
    return;
  }

  vendorsEl.className = "vendor-list";
  vendorsEl.innerHTML = rows
    .map((vendor) => {
      const quote = vendor.quote;
      const quoteText = quote
        ? `${quote.currency || "USD"} ${quote.priceMin ?? "?"}-${quote.priceMax ?? "?"}`
        : "Quote pending";
      const tagClass = vendor.status === "responded" ? "ok" : "warn";

      return `
        <div class="vendor-row">
          <div><strong>${escapeHtml(vendor.name)}</strong><div>${escapeHtml(vendor.phone)}</div></div>
          <div>Rating ${escapeHtml(String(vendor.rating || 0))}</div>
          <div>${escapeHtml(String(vendor.distance_km || "-"))} km</div>
          <div><span class="tag ${tagClass}">${escapeHtml(vendor.status)}</span> ${escapeHtml(quoteText)}</div>
        </div>
      `;
    })
    .join("");
}

function renderMessage(message) {
  jobMetaEl.innerHTML = `<div class="meta-row">${escapeHtml(message)}</div>`;
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
