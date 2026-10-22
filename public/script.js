"use strict";

const PERSONALIZATION = {
  senderName: "Your Secret Admirer",
  dateIdea: "a cozy café and something sweet"
};

const nameStep = document.querySelector("#nameStep");
const nameForm = document.querySelector("#nameForm");
const nameInput = document.querySelector("#nameInput");
const nameError = document.querySelector("#nameError");
const invitation = document.querySelector("#invitationContent");
const celebration = document.querySelector("#celebration");
const goodbye = document.querySelector("#goodbye");
const actionArea = document.querySelector("#actionArea");
const yesButton = document.querySelector("#yesButton");
const noButton = document.querySelector("#noButton");
const maybeButton = document.querySelector("#maybeButton");
const pleaMessage = document.querySelector("#pleaMessage");
const saveStatus = document.querySelector("#saveStatus");
const confetti = document.querySelector("#confetti");

const pleadingMessages = [
  "Are you suuure? 🥺",
  "The teddy really believes in us… 🧸",
  "What if there are snacks? 🍰",
  "Pretty please with a cherry on top? 🍒",
  "My heart says you meant ‘Yes’ 💗",
  "I promise to make you smile! ✨",
  "The ‘Yes’ button looks extra cute today 🌷",
  "Okay, one more tiny chance? 💕"
];

let guestName = "";
let noAttempts = 0;
let submissionState = "idle";
let requestId = "";
let lastMoveAt = 0;

function normalizeName(value) {
  const unicodeName = value.normalize("NFC");
  if (/[\p{Cc}\p{Cf}]/u.test(unicodeName)) return { error: "Please use a name without control or direction-changing characters." };
  const name = unicodeName.replace(/\s+/gu, " ").trim();
  if (!name) return { error: "Please tell the teddy what to call you." };
  if (Array.from(name).length > 60) return { error: "Please keep your name to 60 characters or fewer." };
  return { name };
}

function fillPersonalization() {
  document.querySelectorAll("[data-guest]").forEach((node) => { node.textContent = guestName || "you"; });
  document.querySelectorAll("[data-sender]").forEach((node) => { node.textContent = PERSONALIZATION.senderName || "someone special"; });
  document.querySelectorAll("[data-date-idea]").forEach((node) => { node.textContent = PERSONALIZATION.dateIdea || "something lovely together"; });
  document.title = "A little question for you…";
}

function showInvitation(event) {
  event.preventDefault();
  const result = normalizeName(nameInput.value);
  if (result.error) {
    nameError.textContent = result.error;
    nameInput.setAttribute("aria-invalid", "true");
    nameInput.focus();
    return;
  }
  guestName = result.name;
  nameError.textContent = "";
  nameInput.removeAttribute("aria-invalid");
  fillPersonalization();
  nameStep.hidden = true;
  invitation.hidden = false;
  invitation.classList.add("is-visible");
  requestAnimationFrame(() => document.querySelector("#questionTitle").focus?.());
}

function rectanglesOverlap(a, b, padding = 10) {
  return !(a.right + padding < b.left || a.left > b.right + padding || a.bottom + padding < b.top || a.top > b.bottom + padding);
}

function moveNoButton({ countAttempt = true, force = false } = {}) {
  if (submissionState !== "idle") return;
  const now = Date.now();
  if (!force && now - lastMoveAt < 130) return;
  lastMoveAt = now;
  if (countAttempt) noAttempts += 1;

  const areaRect = actionArea.getBoundingClientRect();
  const buttonRect = noButton.getBoundingClientRect();
  const yesRect = yesButton.getBoundingClientRect();
  const safePadding = 8;
  const messageReserve = 40;
  const maxX = Math.max(safePadding, areaRect.width - buttonRect.width - safePadding);
  const maxY = Math.max(safePadding, areaRect.height - buttonRect.height - messageReserve);
  const yesInArea = { left: yesRect.left - areaRect.left, right: yesRect.right - areaRect.left, top: yesRect.top - areaRect.top, bottom: yesRect.bottom - areaRect.top };
  let candidate = { left: safePadding, top: safePadding, right: 0, bottom: 0 };
  let tries = 0;
  do {
    candidate.left = safePadding + Math.random() * Math.max(0, maxX - safePadding);
    candidate.top = safePadding + Math.random() * Math.max(0, maxY - safePadding);
    candidate.right = candidate.left + buttonRect.width;
    candidate.bottom = candidate.top + buttonRect.height;
    tries += 1;
  } while (rectanglesOverlap(candidate, yesInArea, 12) && tries < 30);

  noButton.style.left = `${Math.round(Math.min(maxX, Math.max(safePadding, candidate.left)))}px`;
  noButton.style.top = `${Math.round(Math.min(maxY, Math.max(safePadding, candidate.top)))}px`;
  noButton.style.bottom = "auto";
  noButton.classList.remove("is-dodging");
  void noButton.offsetWidth;
  noButton.classList.add("is-dodging");

  if (countAttempt) {
    pleaMessage.textContent = pleadingMessages[(noAttempts - 1) % pleadingMessages.length];
    const yesScale = Math.min(1.45, 1 + noAttempts * 0.04);
    yesButton.style.setProperty("--yes-scale", yesScale.toFixed(2));
    yesButton.setAttribute("aria-label", `Yes, I'd love to! Still reachable after ${noAttempts} playful ${noAttempts === 1 ? "attempt" : "attempts"}.`);
    if (noAttempts >= 5) maybeButton.hidden = false;
  }
}

function handleNoPointer(event) {
  if (event.pointerType === "touch") event.preventDefault();
  moveNoButton();
}

function setControlsDisabled(disabled) {
  yesButton.disabled = disabled;
  noButton.disabled = disabled;
  maybeButton.disabled = disabled;
}

function makeConfetti() {
  const symbols = ["♥", "♡", "✦", "●", "❀"];
  const colors = ["#d84e78", "#ef86a4", "#f7b6c8", "#fff1a8", "#ffffff"];
  const count = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 58;
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < count; index += 1) {
    const piece = document.createElement("span");
    piece.className = "confetti-piece";
    piece.textContent = symbols[Math.floor(Math.random() * symbols.length)];
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.color = colors[Math.floor(Math.random() * colors.length)];
    piece.style.fontSize = `${8 + Math.random() * 14}px`;
    piece.style.setProperty("--delay", `${Math.random() * 1.25}s`);
    piece.style.setProperty("--fall-time", `${3.1 + Math.random() * 2.2}s`);
    piece.style.setProperty("--sway", `${-70 + Math.random() * 140}px`);
    piece.style.setProperty("--spin", `${240 + Math.random() * 620}deg`);
    fragment.appendChild(piece);
  }
  confetti.replaceChildren(fragment);
}

function celebrate() {
  submissionState = "saved";
  makeConfetti();
  invitation.hidden = true;
  celebration.hidden = false;
  celebration.classList.add("is-visible");
  window.scrollTo({ top: 0, behavior: "smooth" });
  requestAnimationFrame(() => document.querySelector("#celebrationTitle").focus());
}

async function sayYes() {
  if (submissionState !== "idle") return;
  submissionState = "saving";
  requestId ||= crypto.randomUUID();
  setControlsDisabled(true);
  saveStatus.className = "save-status is-saving";
  saveStatus.textContent = "Tucking your Yes safely into the love letter… 💌";
  try {
    const response = await fetch("/api/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: guestName, requestId })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.accepted !== true) throw new Error("Unable to save");
    celebrate();
  } catch {
    submissionState = "idle";
    setControlsDisabled(false);
    saveStatus.className = "save-status is-error";
    saveStatus.textContent = "The love letter fluttered away. Please tap Yes to try once more. 💗";
    yesButton.focus();
  }
}

function sayMaybe() {
  if (submissionState !== "idle") return;
  submissionState = "goodbye";
  invitation.hidden = true;
  goodbye.hidden = false;
  goodbye.classList.add("is-visible");
  requestAnimationFrame(() => document.querySelector("#goodbyeTitle").focus());
}

nameForm.addEventListener("submit", showInvitation);
nameInput.addEventListener("input", () => {
  if (!nameError.textContent) return;
  const result = normalizeName(nameInput.value);
  nameError.textContent = result.error || "";
  if (!result.error) nameInput.removeAttribute("aria-invalid");
});
yesButton.addEventListener("click", sayYes);
noButton.addEventListener("pointerenter", handleNoPointer);
noButton.addEventListener("pointerdown", handleNoPointer);
noButton.addEventListener("click", (event) => { event.preventDefault(); moveNoButton(); });
noButton.addEventListener("animationend", () => noButton.classList.remove("is-dodging"));
maybeButton.addEventListener("click", sayMaybe);
window.addEventListener("resize", () => {
  if (noAttempts > 0 && submissionState === "idle") moveNoButton({ countAttempt: false, force: true });
});
