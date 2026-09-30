"use strict";

function renderVisuals(session, comparisonSession, seekTo) {
  const byId = id => document.getElementById(id);
  const make = (tag, className, value) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = String(value);
    return node;
  };
  const appendText = (parent, tag, className, value) => {
    const node = make(tag, className, value);
    parent.append(node);
    return node;
  };
  const items = [...session.ingredients, ...session.events];
  const reviewed = items.filter(item => item.reviewed).length;
  const estimated = items.filter(item => item.evidence === "estimated").length;
  const knownMass = session.ingredients.filter(item => item.quantity_g !== null).length;
  const summary = byId("viz-summary");
  summary.replaceChildren();
  for (const [value, label] of [
    [session.events.length, "Ordered steps"],
    [`${reviewed}/${items.length}`, "Reviewed items"],
    [estimated, "Estimates"],
    [`${knownMass}/${session.ingredients.length}`, "Known quantities"],
  ]) {
    const card = make("div", "viz-stat");
    appendText(card, "strong", "", value);
    appendText(card, "span", "", label);
    summary.append(card);
  }

  const timeline = byId("process-timeline");
  timeline.replaceChildren();
  if (!session.events.length) appendText(timeline, "p", "empty-view", "Add events or load a case to inspect the cooking sequence.");
  for (const [index, event] of session.events.entries()) {
    const entry = make("div", "timeline-entry");
    appendText(entry, "span", "timeline-index", String(index + 1).padStart(2, "0"));
    const body = make("div", "timeline-body");
    const top = make("div", "timeline-top");
    appendText(top, "strong", "action-name", event.action.toUpperCase());
    appendText(top, "span", "timeline-time", event.timestamp_s === null ? "recipe order" : `${event.timestamp_s}s in clip`);
    body.append(top);
    appendText(body, "p", "timeline-description", event.description);
    const details = make("div", "timeline-details");
    for (const detail of [event.ingredient, `in ${event.vessel}`,
      event.duration_s === null ? null : `${event.duration_s}s step`,
      event.target_temperature_c === null ? null : `${event.target_temperature_c}°C target`,
      event.particle_size_mm === null ? null : `${event.particle_size_mm}mm pieces`,
      event.evidence, event.reviewed ? "reviewed" : "needs review"].filter(Boolean)) {
      appendText(details, "span", detail === event.evidence ? `evidence-tag ${event.evidence}` : "", detail);
    }
    body.append(details);
    if (event.timestamp_s !== null) {
      const jump = appendText(body, "button", "seek-step", "View frame");
      jump.type = "button";
      jump.disabled = !byId("video") || byId("video").hidden;
      jump.addEventListener("click", () => seekTo(event.timestamp_s));
    }
    entry.append(body);
    timeline.append(entry);
  }

  const evidenceView = byId("evidence-view");
  evidenceView.replaceChildren();
  const evidenceCounts = Object.fromEntries(["observed", "instructed", "estimated"].map(key => [key, items.filter(item => item.evidence === key).length]));
  const bar = make("div", "stacked-bar");
  bar.setAttribute("role", "img");
  bar.setAttribute("aria-label", `Evidence: ${evidenceCounts.observed} observed, ${evidenceCounts.instructed} instructed, ${evidenceCounts.estimated} estimated`);
  for (const type of ["observed", "instructed", "estimated"]) {
    const segment = make("span", `segment ${type}`);
    segment.style.width = items.length ? `${100 * evidenceCounts[type] / items.length}%` : "0%";
    bar.append(segment);
  }
  evidenceView.append(bar);
  const legend = make("div", "evidence-legend");
  for (const type of ["observed", "instructed", "estimated"]) {
    const item = make("span", "legend-item");
    item.append(make("i", `legend-swatch ${type}`), document.createTextNode(`${type} ${evidenceCounts[type]}`));
    legend.append(item);
  }
  evidenceView.append(legend);
  const review = make("div", "review-track");
  const reviewFill = make("span", "review-fill");
  reviewFill.style.width = items.length ? `${100 * reviewed / items.length}%` : "0%";
  review.append(reviewFill);
  appendText(evidenceView, "p", "chart-label", `${reviewed} of ${items.length} annotations reviewed`);
  evidenceView.append(review);

  const ingredientView = byId("ingredient-view");
  ingredientView.replaceChildren();
  if (!session.ingredients.length) appendText(ingredientView, "p", "empty-view", "No ingredients recorded.");
  const maximum = Math.max(1, ...session.ingredients.map(item => item.quantity_g || 0));
  for (const item of session.ingredients) {
    const line = make("div", "ingredient-bar-row");
    const heading = make("div", "ingredient-bar-heading");
    appendText(heading, "strong", "", item.name);
    appendText(heading, "span", "", item.quantity_g === null ? "amount unknown" : `${item.quantity_g} g`);
    line.append(heading);
    const track = make("div", "quantity-track");
    const fill = make("span", "quantity-fill");
    fill.style.width = item.quantity_g === null ? "0%" : `${100 * item.quantity_g / maximum}%`;
    track.append(fill);
    line.append(track);
    appendText(line, "span", "preparation-label", `${item.preparation} · ${item.evidence}${item.reviewed ? " · reviewed" : " · needs review"}`);
    ingredientView.append(line);
  }

  const compareBox = byId("compare-box");
  compareBox.hidden = !comparisonSession;
  const comparison = byId("compare-timeline");
  comparison.replaceChildren();
  if (comparisonSession) {
    const ingredientsMatch = JSON.stringify(session.ingredients.map(item => [item.name, item.quantity_g])) ===
      JSON.stringify(comparisonSession.ingredients.map(item => [item.name, item.quantity_g]));
    byId("compare-label").textContent = `${session.title} versus ${comparisonSession.title}. ${ingredientsMatch ? "Both cases use the same listed ingredients and amounts; the first additions differ." : "The current ingredient list differs from the authored comparison case; interpret the order comparison with that change in mind."}`;
    for (const variant of [session, comparisonSession]) {
      const column = make("div", "comparison-column");
      appendText(column, "h4", "", variant.title);
      for (const [index, event] of variant.events.entries()) {
        const line = make("div", "comparison-step");
        appendText(line, "span", "", String(index + 1).padStart(2, "0"));
        appendText(line, "strong", "", event.action);
        appendText(line, "span", "", event.ingredient || event.description);
        column.append(line);
      }
      comparison.append(column);
    }
  }
}
