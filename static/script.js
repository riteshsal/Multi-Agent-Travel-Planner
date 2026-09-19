let currentThreadId = localStorage.getItem("travel_thread_id") || null;
let latestAnswerMarkdown = "";

function setPrompt(text) {
    document.getElementById("userInput").value = text;
}

function setLoading(isLoading) {
    const sendBtn = document.getElementById("sendBtn");
    const btnText = document.getElementById("btnText");
    const btnLoader = document.getElementById("btnLoader");

    sendBtn.disabled = isLoading;

    if (isLoading) {
        btnText.classList.add("hidden");
        btnLoader.classList.remove("hidden");
    } else {
        btnText.classList.remove("hidden");
        btnLoader.classList.add("hidden");
    }
}

function setResumeLoading(isLoading) {
    const approveBtn = document.getElementById("approveBtn");
    const revisionBtn = document.getElementById("revisionBtn");

    approveBtn.disabled = isLoading;
    revisionBtn.disabled = isLoading;

    approveBtn.textContent = isLoading ? "Working..." : "✅ Approve";
    revisionBtn.textContent = isLoading ? "Working..." : "Request Revision";
}

function showError(message) {
    const errorBox = document.getElementById("errorBox");

    errorBox.textContent = message;
    errorBox.classList.remove("hidden");
}

function hideError() {
    const errorBox = document.getElementById("errorBox");

    errorBox.classList.add("hidden");
    errorBox.textContent = "";
}

function hideApproval() {
    document.getElementById("approvalSection").classList.add("hidden");
    document.getElementById("feedbackInput").value = "";
}

function hideResult() {
    document.getElementById("resultSection").classList.add("hidden");
}

// Renders the draft itinerary and shows the approve/revise panel.
// Called when the backend pauses at the human-in-the-loop interrupt()
// step (requires_approval: true in the /api/travel or /api/resume response).
function showApproval(data) {
    hideResult();
    hideError();

    const approvalSection = document.getElementById("approvalSection");
    const approvalRequestText = document.getElementById("approvalRequestText");
    const draftItineraryBox = document.getElementById("draftItineraryBox");

    approvalRequestText.textContent =
        data.approval_request ||
        "Please review the generated draft itinerary. Approve it to create the final polished plan, or provide feedback for revision.";

    const draftText = data.itinerary || data.answer || "";

    if (typeof marked !== "undefined") {
        draftItineraryBox.innerHTML = marked.parse(draftText);
    } else {
        draftItineraryBox.innerText = draftText;
    }

    approvalSection.classList.remove("hidden");

    approvalSection.scrollIntoView({
        behavior: "smooth",
        block: "start"
    });
}

function showResult(answer, threadId) {
    hideApproval();

    latestAnswerMarkdown = answer;

    const resultSection = document.getElementById("resultSection");
    const resultBox = document.getElementById("resultBox");
    const threadInfo = document.getElementById("threadInfo");

    if (typeof marked !== "undefined") {
        resultBox.innerHTML = marked.parse(answer);
    } else {
        resultBox.innerText = answer;
    }

    threadInfo.textContent = `Thread ID: ${threadId}`;

    resultSection.classList.remove("hidden");

    resultSection.scrollIntoView({
        behavior: "smooth",
        block: "start"
    });
}

// Central place that decides what to render based on the backend's
// response shape: a guardrail block, a paused-for-approval state,
// or a completed final answer.
function handleTravelResponse(data) {
    currentThreadId = data.thread_id;
    localStorage.setItem("travel_thread_id", currentThreadId);

    if (data.guardrail_allowed === false) {
        hideApproval();
        hideResult();
        showError(
            data.guardrail_reason ||
            "This request isn't a travel-planning request, so it was blocked."
        );
        return;
    }

    if (data.requires_approval) {
        showApproval(data);
        return;
    }

    showResult(data.answer, data.thread_id);
}

async function sendMessage() {
    hideError();

    const input = document.getElementById("userInput");
    const message = input.value.trim();

    if (!message) {
        showError("Please enter your travel request first.");
        return;
    }

    setLoading(true);

    try {
        const response = await fetch("/api/travel", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                message: message,
                thread_id: currentThreadId
            })
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.error || "Something went wrong.");
        }

        handleTravelResponse(data);

    } catch (error) {
        showError(error.message);
    } finally {
        setLoading(false);
    }
}

// Sends the approval decision back to the backend, which resumes the
// paused LangGraph thread from human_approval_agent's interrupt() call.
async function resumeTravel(approved, feedback) {
    if (!currentThreadId) {
        showError("No active plan to respond to. Please generate a plan first.");
        return;
    }

    hideError();
    setResumeLoading(true);

    try {
        const response = await fetch("/api/resume", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                thread_id: currentThreadId,
                approved: approved,
                feedback: feedback || ""
            })
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.error || "Something went wrong.");
        }

        handleTravelResponse(data);

    } catch (error) {
        showError(error.message);
    } finally {
        setResumeLoading(false);
    }
}

function approveItinerary() {
    resumeTravel(true, "");
}

function requestRevision() {
    const feedbackInput = document.getElementById("feedbackInput");
    const feedback = feedbackInput.value.trim();

    if (!feedback) {
        showError("Please describe what you'd like changed before requesting a revision.");
        return;
    }

    resumeTravel(false, feedback);
}

function copyResult() {
    const resultBox = document.getElementById("resultBox");
    const text = resultBox.innerText;

    if (!text) {
        return;
    }

    navigator.clipboard.writeText(text)
        .then(() => {
            const copyBtn = document.querySelector(".copy-btn");
            const oldText = copyBtn.textContent;

            copyBtn.textContent = "Copied!";

            setTimeout(() => {
                copyBtn.textContent = oldText;
            }, 1400);
        })
        .catch(() => {
            showError("Could not copy result.");
        });
}

function downloadPDF() {
    const pdfContent = document.getElementById("pdfContent");

    if (!latestAnswerMarkdown || !pdfContent) {
        showError("No travel plan available to download.");
        return;
    }

    const downloadBtn = document.querySelector(".download-btn");
    const oldText = downloadBtn.textContent;

    downloadBtn.textContent = "Preparing PDF...";
    downloadBtn.disabled = true;

    const options = {
        margin: 0.5,
        filename: "ai-travel-plan.pdf",
        image: {
            type: "jpeg",
            quality: 0.98
        },
        html2canvas: {
            scale: 2,
            useCORS: true,
            backgroundColor: "#ffffff"
        },
        jsPDF: {
            unit: "in",
            format: "a4",
            orientation: "portrait"
        },
        pagebreak: {
            mode: ["avoid-all", "css", "legacy"]
        }
    };

    html2pdf()
        .set(options)
        .from(pdfContent)
        .save()
        .then(() => {
            downloadBtn.textContent = oldText;
            downloadBtn.disabled = false;
        })
        .catch(() => {
            downloadBtn.textContent = oldText;
            downloadBtn.disabled = false;
            showError("Could not download PDF.");
        });
}

document.addEventListener("keydown", function(event) {
    if (event.ctrlKey && event.key === "Enter") {
        sendMessage();
    }
});