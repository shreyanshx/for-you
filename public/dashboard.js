"use strict";

document.querySelectorAll("[data-local-time]").forEach((node) => {
  const value = node.getAttribute("data-local-time");
  const date = new Date(value);
  if (!Number.isNaN(date.valueOf())) {
    node.textContent = date.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    });
  }
});
