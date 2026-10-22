/* ─────────────────────────────────────────────────────────────
   PERSONALIZE ME — edit these three values, then save the file.
   Keep the quote marks. Emoji are welcome! Examples:
   recipientName: "Maya", senderName: "Alex", dateIdea: "sunset gelato"
   ───────────────────────────────────────────────────────────── */
const PERSONALIZATION = {
  recipientName: "Beautiful",
  senderName: "Your Secret Admirer",
  dateIdea: "a cozy café and something sweet"
};

const invitation = document.querySelector("#invitationContent");
const celebration = document.querySelector("#celebration");
const actionArea = document.querySelector("#actionArea");
const yesButton = document.querySelector("#yesButton");
const noButton = document.querySelector("#noButton");
const pleaMessage = document.querySelector("#pleaMessage");
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

let noAttempts = 0;
let hasCelebrated = false;
let lastMoveAt = 0;

function fillPersonalization() {
  document.querySelectorAll("[data-recipient]").forEach((node) => {
    node.textContent = PERSONALIZATION.recipientName || "you";
  });
  document.querySelectorAll("[data-sender]").forEach((node) => {
    node.textContent = PERSONALIZATION.senderName || "someone special";
  });
  document.querySelectorAll("[data-date-idea]").forEach((node) => {
    node.textContent = PERSONALIZATION.dateIdea || "something lovely together";
  });
  document.title = `A little question for ${PERSONALIZATION.recipientName || "you"}…`;
}

function rectanglesOverlap(a, b, padding = 10) {
  return !(
    a.right + padding < b.left ||
    a.left > b.right + padding ||
    a.bottom + padding < b.top ||
    a.top > b.bottom + padding
  );
}

function moveNoButton(force = false) {
  if (hasCelebrated) return;

  const now = Date.now();
  if (!force && now - lastMoveAt < 130) return;
  lastMoveAt = now;
  noAttempts += 1;

  const areaRect = actionArea.getBoundingClientRect();
  const buttonRect = noButton.getBoundingClientRect();
  const yesRect = yesButton.getBoundingClientRect();
  const safePadding = 8;
  const messageReserve = 39;
  const maxX = Math.max(safePadding, areaRect.width - buttonRect.width - safePadding);
  const maxY = Math.max(safePadding, areaRect.height - buttonRect.height - messageReserve);
  const yesInArea = {
    left: yesRect.left - areaRect.left,
    right: yesRect.right - areaRect.left,
    top: yesRect.top - areaRect.top,
    bottom: yesRect.bottom - areaRect.top
  };

  let candidate = { left: safePadding, top: safePadding, right: 0, bottom: 0 };
  let tries = 0;
  do {
    candidate.left = safePadding + Math.random() * Math.max(0, maxX - safePadding);
    candidate.top = safePadding + Math.random() * Math.max(0, maxY - safePadding);
    candidate.right = candidate.left + buttonRect.width;
    candidate.bottom = candidate.top + buttonRect.height;
    tries += 1;
  } while (rectanglesOverlap(candidate, yesInArea, 12) && tries < 30);

  // Every position is calculated inside the visible action area. The area itself
  // is within the card/viewport, so the button cannot escape off-screen.
  noButton.style.left = `${Math.round(Math.min(maxX, Math.max(safePadding, candidate.left)))}px`;
  noButton.style.top = `${Math.round(Math.min(maxY, Math.max(safePadding, candidate.top)))}px`;
  noButton.style.bottom = "auto";
  noButton.classList.remove("is-dodging");
  void noButton.offsetWidth;
  noButton.classList.add("is-dodging");

  pleaMessage.textContent = pleadingMessages[(noAttempts - 1) % pleadingMessages.length];
  const yesScale = Math.min(1.48, 1 + noAttempts * 0.045);
  yesButton.style.setProperty("--yes-scale", yesScale.toFixed(2));
  yesButton.setAttribute("aria-label", `Yes, I'd love to! The hopeful choice after ${noAttempts} playful ${noAttempts === 1 ? "attempt" : "attempts"}.`);
}

function handleNoPointer(event) {
  // Pointer events cover mouse, pen, and touch. Preventing the touch press keeps
  // browsers from firing a delayed synthetic click at the button's old position.
  if (event.pointerType === "touch") event.preventDefault();
  moveNoButton();
}

function makeConfetti() {
  const symbols = ["♥", "♡", "✦", "●", "❀"];
  const colors = ["#d84e78", "#ef86a4", "#f7b6c8", "#fff1a8", "#ffffff"];
  const count = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 54;

  const fragment = document.createDocumentFragment();
  for (let i = 0; i < count; i += 1) {
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

function sayYes() {
  if (hasCelebrated) return;
  hasCelebrated = true;
  makeConfetti();
  invitation.setAttribute("aria-hidden", "true");
  invitation.hidden = true;
  celebration.hidden = false;
  celebration.classList.add("is-visible");
  document.body.classList.add("has-celebrated");
  window.scrollTo({ top: 0, behavior: "smooth" });
  requestAnimationFrame(() => document.querySelector("#celebrationTitle").focus?.());
}

fillPersonalization();

yesButton.addEventListener("click", sayYes);
noButton.addEventListener("pointerenter", handleNoPointer);
noButton.addEventListener("pointerdown", handleNoPointer);
noButton.addEventListener("click", (event) => {
  event.preventDefault();
  moveNoButton();
});
noButton.addEventListener("animationend", () => noButton.classList.remove("is-dodging"));

// Re-home the moving button if screen rotation or resizing would leave it outside.
window.addEventListener("resize", () => {
  if (noAttempts > 0 && !hasCelebrated) moveNoButton(true);
});
